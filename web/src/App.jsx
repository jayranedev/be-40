import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useChainId, useDisconnect, usePublicClient, useReadContract, useSignMessage, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { isAddress, parseAbiItem } from 'viem';
import * as faceapi from 'face-api.js';
import '@tensorflow/tfjs-backend-webgl';
import { setBackend } from '@tensorflow/tfjs-core';
import { makeCommitmentFromEmbedding, randomHex } from './lib/crypto.js';
import { hasProjectId } from './wallet.js';
import { identityAbi } from './lib/identityAbi.js';
import { BASE_SEPOLIA_CHAIN_ID, IDENTITY_CONTRACT_ADDRESS, IDENTITY_OWNER_ADDRESS } from './lib/contract.js';
import {
  hasEncryptedTemplate,
  hasTemplate,
  decryptTemplate,
  encryptTemplate,
  loadEncryptedTemplate,
  loadTemplate,
  saveEncryptedTemplate,
  saveTemplate,
} from './lib/biometricStore.js';
import { derivePassphraseFromSignature } from './lib/walletKey.js';
import { loadRemoteTemplate, saveRemoteTemplate } from './lib/remoteTemplates.js';
import { exportProofCalldata, generateAuthProof, verifyAuthProof } from './lib/zk.js';

const views = [
  { id: 'home', label: 'Landing' },
  { id: 'profile', label: 'Profile' },
  { id: 'enroll', label: 'Enroll' },
  { id: 'login', label: 'Login Check' },
  { id: 'verify', label: 'Verify Wallet' },
  { id: 'proofs', label: 'Realtime Proofs' },
];

const identityMintedEvent = parseAbiItem(
  'event IdentityMinted(address indexed owner, uint256 indexed tokenId, bytes32 faceCommitment, uint256 nonce)'
);
const identityRevokedEvent = parseAbiItem(
  'event IdentityRevoked(address indexed owner, uint256 indexed tokenId)'
);
const authProofEvent = parseAbiItem(
  'event AuthProofSubmitted(address indexed owner, uint256 indexed tokenId, bytes32 commitment, uint256 nonce)'
);

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const REQUIRED_BLINKS = 2;
const EYE_AR_THRESHOLD = 0.23;
const MATCH_THRESHOLD = 0.5;
const PROOFS_WINDOW = 5000n;
const LOGIN_PROOF_WINDOW_MS = 5 * 60 * 1000;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(eye) {
  const a = distance(eye[1], eye[5]);
  const b = distance(eye[2], eye[4]);
  const c = distance(eye[0], eye[3]);
  return (a + b) / (2.0 * c);
}

export default function App() {
  const [view, setView] = useState('home');
  const [wallet, setWallet] = useState('0xA1B2...');
  const [verifyWallet, setVerifyWallet] = useState('');
  const [enrollResult, setEnrollResult] = useState(null);
  const [enrollError, setEnrollError] = useState('');
  const [pendingCommitment, setPendingCommitment] = useState('');
  const [enrollWallet, setEnrollWallet] = useState('');
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [enrollFaceDetected, setEnrollFaceDetected] = useState(false);
  const [enrollBlinkCount, setEnrollBlinkCount] = useState(0);
  const [enrollLivenessPassed, setEnrollLivenessPassed] = useState(false);
  const [enrollDescriptor, setEnrollDescriptor] = useState(null);
  const [loginFaceDetected, setLoginFaceDetected] = useState(false);
  const [loginBlinkCount, setLoginBlinkCount] = useState(0);
  const [loginLivenessPassed, setLoginLivenessPassed] = useState(false);
  const [loginDescriptor, setLoginDescriptor] = useState(null);
  const [lastLoginDescriptor, setLastLoginDescriptor] = useState(null);
  const [lastLoginAt, setLastLoginAt] = useState(null);
  const [lastLoginWallet, setLastLoginWallet] = useState('');
  const [lastMatchedTemplate, setLastMatchedTemplate] = useState(null);
  const [loginResult, setLoginResult] = useState('');
  const [loginScore, setLoginScore] = useState(null);
  const [deviceKey, setDeviceKey] = useState('');
  const [deviceKeyVisible, setDeviceKeyVisible] = useState(false);
  const [deviceKeySource, setDeviceKeySource] = useState('manual');
  const [deviceKeyError, setDeviceKeyError] = useState('');
  const [remoteTemplate, setRemoteTemplate] = useState(null);
  const [remoteTemplateError, setRemoteTemplateError] = useState('');
  const [remoteTemplateLoading, setRemoteTemplateLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [currentBlock, setCurrentBlock] = useState(null);
  const [proofsFeed, setProofsFeed] = useState([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [proofsError, setProofsError] = useState('');
  const [proofsFromBlock, setProofsFromBlock] = useState('');
  const [proofsToBlock, setProofsToBlock] = useState('');
  const [proofsWindowSize, setProofsWindowSize] = useState(PROOFS_WINDOW.toString());
  const [csvStatus, setCsvStatus] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchMintLog, setSearchMintLog] = useState(null);
  const [searchRevokeLog, setSearchRevokeLog] = useState(null);
  const [proofAction, setProofAction] = useState('');
  const [proofError, setProofError] = useState('');
  const [lastProof, setLastProof] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastEyeOpenRef = useRef({ enroll: true, login: true });
  const livenessRef = useRef({ enroll: false, login: false });
  const activeModeRef = useRef('enroll');
  const modelLoadedRef = useRef(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { open } = useWeb3Modal();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const isCorrectChain = chainId === BASE_SEPOLIA_CHAIN_ID;
  const publicClient = usePublicClient();
  const [contractHasCode, setContractHasCode] = useState(true);

  useEffect(() => {
    if (address) {
      setWallet(address);
    }
  }, [address]);

  useEffect(() => {
    const cached = sessionStorage.getItem('faceid-device-key');
    if (cached) {
      setDeviceKey(cached);
      setDeviceKeySource('wallet');
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function checkCode() {
      try {
        const code = await publicClient?.getBytecode({ address: IDENTITY_CONTRACT_ADDRESS });
        if (!ignore) {
          setContractHasCode(Boolean(code && code !== '0x'));
        }
      } catch (error) {
        if (!ignore) {
          setContractHasCode(false);
        }
      }
    }
    if (publicClient) {
      checkCode();
    }
    return () => {
      ignore = true;
    };
  }, [publicClient]);

  useEffect(() => {
    setBackend('webgl');
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (view !== 'enroll') {
      stopCamera();
      resetLiveness('enroll');
    }
    if (view !== 'login') {
      stopCamera();
      resetLiveness('login');
    }
  }, [view]);

  const isWalletValid = isAddress(wallet);
  const isVerifyWalletValid = isAddress(verifyWallet);

  const formatWallet = (value) => {
    if (!value) return '';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  };

  const formatCommitment = (value) => {
    if (!value) return '';
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
  };

  const parseBlockInput = (value) => {
    if (!value && value !== 0) return null;
    try {
      return BigInt(value);
    } catch (error) {
      return null;
    }
  };


  const {
    data: walletTokenId,
    refetch: refetchWalletTokenId,
  } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'walletToTokenId',
    args: isWalletValid ? [wallet] : undefined,
    query: { enabled: isWalletValid },
  });

  const {
    data: walletIdentity,
    refetch: refetchWalletIdentity,
  } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'identities',
    args: walletTokenId && walletTokenId > 0n ? [walletTokenId] : undefined,
    query: { enabled: Boolean(walletTokenId && walletTokenId > 0n) },
  });

  const {
    data: verifyTokenId,
    refetch: refetchVerifyTokenId,
    error: verifyTokenError,
  } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'walletToTokenId',
    args: isVerifyWalletValid ? [verifyWallet] : undefined,
    query: { enabled: isVerifyWalletValid },
  });

  const {
    data: verifyIdentity,
    refetch: refetchVerifyIdentity,
    error: verifyIdentityError,
  } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'identities',
    args: verifyTokenId && verifyTokenId > 0n ? [verifyTokenId] : undefined,
    query: { enabled: Boolean(verifyTokenId && verifyTokenId > 0n) },
  });

  const { data: nextTokenId } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'nextTokenId',
    query: { enabled: true },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const {
    writeContract: writeAuthProof,
    data: authTxHash,
    isPending: isAuthPending,
  } = useWriteContract();
  const {
    data: txReceipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  const {
    data: authReceipt,
    isLoading: isAuthConfirming,
    isSuccess: isAuthConfirmed,
  } = useWaitForTransactionReceipt({
    hash: authTxHash,
  });
  useEffect(() => {
    if (isConfirmed) {
      refetchWalletTokenId();
      refetchWalletIdentity();
    }
  }, [isConfirmed, refetchWalletTokenId, refetchWalletIdentity]);

  useEffect(() => {
    if (!publicClient) return;
    let active = true;
    let timer;
    const fetchBlock = async () => {
      try {
        const blockNumber = await publicClient.getBlockNumber();
        if (active) {
          setCurrentBlock(blockNumber);
        }
      } catch (error) {
        if (active) {
          setCurrentBlock(null);
        }
      }
    };
    fetchBlock();
    timer = setInterval(fetchBlock, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [publicClient]);

  useEffect(() => {
    if (!currentBlock) return;
    if (!proofsFromBlock && !proofsToBlock) {
      const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
      const fromBlock = currentBlock > windowSize ? currentBlock - windowSize : 0n;
      setProofsFromBlock(fromBlock.toString());
      setProofsToBlock(currentBlock.toString());
    }
  }, [currentBlock, proofsFromBlock, proofsToBlock, proofsWindowSize]);

  const resetLiveness = (mode) => {
    if (mode === 'enroll') {
      setEnrollFaceDetected(false);
      setEnrollBlinkCount(0);
      setEnrollLivenessPassed(false);
      setEnrollDescriptor(null);
      lastEyeOpenRef.current.enroll = true;
      livenessRef.current.enroll = false;
    }
    if (mode === 'login') {
      setLoginFaceDetected(false);
      setLoginBlinkCount(0);
      setLoginLivenessPassed(false);
      setLoginDescriptor(null);
      setLoginResult('');
      setLoginScore(null);
      setLastMatchedTemplate(null);
      lastEyeOpenRef.current.login = true;
      livenessRef.current.login = false;
    }
    setCameraError('');
  };

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const loadModels = async () => {
    if (modelLoadedRef.current || modelsLoading) {
      return;
    }
    setModelsLoading(true);
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      modelLoadedRef.current = true;
      setModelsReady(true);
    } catch (error) {
      setCameraError('Failed to load face models.');
    } finally {
      setModelsLoading(false);
    }
  };

  const runDetection = async () => {
    if (!videoRef.current) return;
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.5,
    });
    const result = await faceapi
      .detectSingleFace(videoRef.current, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (result) {
      const mode = activeModeRef.current;
      if (mode === 'enroll') {
        setEnrollFaceDetected(true);
      } else {
        setLoginFaceDetected(true);
      }
      if (!livenessRef.current[mode]) {
        const leftEye = result.landmarks.getLeftEye();
        const rightEye = result.landmarks.getRightEye();
        const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2.0;
        const isClosed = ear < EYE_AR_THRESHOLD;
        if (isClosed && lastEyeOpenRef.current[mode]) {
          lastEyeOpenRef.current[mode] = false;
        } else if (!isClosed && !lastEyeOpenRef.current[mode]) {
          lastEyeOpenRef.current[mode] = true;
          if (mode === 'enroll') {
            setEnrollBlinkCount((prev) => {
              const next = prev + 1;
              if (next >= REQUIRED_BLINKS) {
                setEnrollLivenessPassed(true);
                livenessRef.current.enroll = true;
                setEnrollDescriptor(result.descriptor);
              }
              return next;
            });
          } else {
            setLoginBlinkCount((prev) => {
              const next = prev + 1;
              if (next >= REQUIRED_BLINKS) {
                setLoginLivenessPassed(true);
                livenessRef.current.login = true;
                setLoginDescriptor(result.descriptor);
                setLastLoginDescriptor(result.descriptor);
              }
              return next;
            });
          }
        }
      }
    } else {
      if (activeModeRef.current === 'enroll') {
        setEnrollFaceDetected(false);
      } else {
        setLoginFaceDetected(false);
      }
    }
    rafRef.current = requestAnimationFrame(runDetection);
  };

  const startCamera = async (mode) => {
    setCameraError('');
    await loadModels();
    if (!modelLoadedRef.current) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      activeModeRef.current = mode;
      setCameraOn(true);
      resetLiveness(mode);
      rafRef.current = requestAnimationFrame(runDetection);
    } catch (error) {
      setCameraError('Camera access denied or unavailable.');
    }
  };

  const handleEnroll = async () => {
    setEnrollError('');
    if (!isConnected) {
      setEnrollError('Connect your wallet to mint.');
      return;
    }
    if (!isCorrectChain) {
      setEnrollError('Switch to Base Sepolia (84532).');
      return;
    }
    if (!enrollDescriptor) {
      setEnrollError('Complete liveness and capture a face first.');
      return;
    }
    const nonce = randomHex(12);
    const commitment = await makeCommitmentFromEmbedding({
      descriptor: enrollDescriptor,
      wallet,
      nonce,
    });
    const nonceValue = BigInt(`0x${nonce}`);
    const commitmentBytes32 = `0x${commitment}`;
    setPendingCommitment(commitmentBytes32);
    try {
      const sameWallet = address?.toLowerCase() === wallet.toLowerCase();
      writeContract({
        address: IDENTITY_CONTRACT_ADDRESS,
        abi: identityAbi,
        functionName: sameWallet ? 'mintSelf' : 'mint',
        args: sameWallet
          ? [commitmentBytes32, nonceValue]
          : [wallet, commitmentBytes32, nonceValue],
      });
      setEnrollResult({
        faceCommitment: commitmentBytes32,
        version: 1,
        functionName: sameWallet ? 'mintSelf' : 'mint',
        targetWallet: wallet,
        nonce: nonceValue.toString(),
      });
      setEnrollWallet(wallet);
    } catch (error) {
      setEnrollError(error?.shortMessage || 'Transaction failed to submit.');
    }
  };

  useEffect(() => {
    if (!isConfirmed || !enrollWallet || !enrollDescriptor) {
      return;
    }
    let active = true;
    const persistTemplate = async () => {
      try {
        if (deviceKey) {
          const payload = await saveEncryptedTemplate({
            wallet: enrollWallet,
            descriptor: enrollDescriptor,
            passphrase: deviceKey,
          });
          try {
            await saveRemoteTemplate({ wallet: enrollWallet, payload });
            if (active) {
              setSyncStatus('Synced to cloud.');
              refreshRemoteTemplate(enrollWallet);
            }
          } catch (error) {
            if (active) {
              setSyncStatus('Local save only. Cloud sync failed.');
            }
          }
        } else {
          saveTemplate(enrollWallet, enrollDescriptor);
          if (active) {
            setSyncStatus('Saved locally. Set a device key for cloud sync.');
          }
        }
      } catch (error) {
        if (active) {
          setEnrollError('Failed to store face template locally.');
        }
      }
    };
    persistTemplate();
    return () => {
      active = false;
    };
  }, [isConfirmed, enrollWallet, enrollDescriptor, deviceKey]);

  const handleLoginCheck = async () => {
    setLoginResult('');
    setLoginScore(null);
    if (!loginDescriptor) {
      setLoginResult('Complete liveness and capture a face first.');
      return;
    }
    let stored = null;
    if (deviceKey) {
      try {
        const remote = await loadRemoteTemplate({ wallet });
        if (remote?.payload) {
          stored = await decryptTemplate({ payload: remote.payload, passphrase: deviceKey });
          await saveEncryptedTemplate({
            wallet,
            descriptor: stored,
            passphrase: deviceKey,
          });
          setSyncStatus('Restored template from cloud.');
        }
      } catch (error) {
        stored = null;
      }
      if (!stored) {
        stored = await loadEncryptedTemplate({ wallet, passphrase: deviceKey });
      }
      if (!stored) {
        setLoginResult('No encrypted cloud template found or device key mismatch.');
        return;
      }
    } else {
      setLoginResult('Set a device key to use the encrypted cloud template.');
      return;
    }
    const distance = faceapi.euclideanDistance(loginDescriptor, stored);
    setLoginScore(distance);
    if (distance <= MATCH_THRESHOLD) {
      setLoginResult('Match confirmed. Same person.');
      setLastLoginAt(Date.now());
      setLastLoginWallet(wallet);
      setLastMatchedTemplate(stored);
    } else {
      setLoginResult('No match. Face does not match the enrolled owner.');
      setLastMatchedTemplate(null);
    }
  };

  const verifyResult = useMemo(() => {
    if (!verifyWallet) return null;
    if (!isVerifyWalletValid) return 'Invalid address';
    if (!verifyTokenId || verifyTokenId === 0n) return 'Not verified';
    if (!verifyIdentity) return 'Not verified';
    const status = Number(verifyIdentity[1]);
    return status === 0 ? 'Verified' : 'Revoked';
  }, [verifyWallet, isVerifyWalletValid, verifyTokenId, verifyIdentity]);

  const loginMatched = useMemo(() => {
    return Boolean(loginScore !== null && loginScore <= MATCH_THRESHOLD);
  }, [loginScore]);

  const templateStatus = useMemo(() => {
    if (!wallet || !isWalletValid) {
      return { plain: false, encrypted: false, remote: false };
    }
    return {
      plain: hasTemplate(wallet),
      encrypted: hasEncryptedTemplate(wallet),
      remote: Boolean(remoteTemplate),
    };
  }, [wallet, isWalletValid, isConfirmed, deviceKey, remoteTemplate]);

  const totalVerified = useMemo(() => {
    if (!nextTokenId || nextTokenId === 0n) return null;
    return Number(nextTokenId - 1n);
  }, [nextTokenId]);

  const proofsSummary = useMemo(() => {
    const minted = proofsFeed.filter((item) => item.type === 'onboard').length;
    const revoked = proofsFeed.filter((item) => item.type === 'revoked').length;
    const auth = proofsFeed.filter((item) => item.type === 'auth').length;
    return { minted, revoked, auth };
  }, [proofsFeed]);

  const blockAge = (blockNumber) => {
    if (!currentBlock || blockNumber === null || blockNumber === undefined) {
      return null;
    }
    const delta = currentBlock > blockNumber ? currentBlock - blockNumber : 0n;
    return Number(delta);
  };

  const refreshRemoteTemplate = async (targetWallet) => {
    if (!targetWallet || !isAddress(targetWallet)) {
      setRemoteTemplate(null);
      return;
    }
    setRemoteTemplateError('');
    setRemoteTemplateLoading(true);
    try {
      const data = await loadRemoteTemplate({ wallet: targetWallet });
      setRemoteTemplate(data);
    } catch (error) {
      setRemoteTemplate(null);
      setRemoteTemplateError(error?.message || 'Failed to load cloud template.');
    } finally {
      setRemoteTemplateLoading(false);
    }
  };

  useEffect(() => {
    if (!publicClient || view !== 'proofs') return;
    let active = true;
    let timer;
    const fetchProofs = async () => {
      setProofsLoading(true);
      setProofsError('');
      try {
        const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
        const autoFrom =
          currentBlock && currentBlock > windowSize ? currentBlock - windowSize : 0n;
        let fromBlock = parseBlockInput(proofsFromBlock);
        let toBlock = parseBlockInput(proofsToBlock);
        if (fromBlock === null) {
          fromBlock = autoFrom;
        }
        if (toBlock !== null && toBlock < fromBlock) {
          const swap = fromBlock;
          fromBlock = toBlock;
          toBlock = swap;
        }
        const [mintedLogs, revokedLogs, authLogs] = await Promise.all([
          publicClient.getLogs({
            address: IDENTITY_CONTRACT_ADDRESS,
            event: identityMintedEvent,
            fromBlock,
            toBlock: toBlock ?? 'latest',
          }),
          publicClient.getLogs({
            address: IDENTITY_CONTRACT_ADDRESS,
            event: identityRevokedEvent,
            fromBlock,
            toBlock: toBlock ?? 'latest',
          }),
          publicClient.getLogs({
            address: IDENTITY_CONTRACT_ADDRESS,
            event: authProofEvent,
            fromBlock,
            toBlock: toBlock ?? 'latest',
          }),
        ]);
        if (!active) return;
        const authFeed = (authLogs || []).map((log) => ({
          type: 'auth',
          wallet: log.args?.owner,
          tokenId: log.args?.tokenId,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          createdAt: null,
        }));
        const feed = [
          ...authFeed,
          ...mintedLogs.map((log) => ({
            type: 'onboard',
            wallet: log.args?.owner,
            tokenId: log.args?.tokenId,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
          })),
          ...revokedLogs.map((log) => ({
            type: 'revoked',
            wallet: log.args?.owner,
            tokenId: log.args?.tokenId,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
          })),
        ].sort((a, b) => {
          if (!a.blockNumber && b.blockNumber) return -1;
          if (a.blockNumber && !b.blockNumber) return 1;
          if (a.blockNumber === b.blockNumber) return 0;
          return a.blockNumber > b.blockNumber ? -1 : 1;
        });
        setProofsFeed(feed);
      } catch (error) {
        if (active) {
          setProofsError('Failed to load realtime proofs. Check RPC or contract address.');
        }
      } finally {
        if (active) {
          setProofsLoading(false);
        }
      }
    };
    fetchProofs();
    timer = setInterval(fetchProofs, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    publicClient,
    view,
    currentBlock,
    proofsFromBlock,
    proofsToBlock,
    proofsWindowSize,
  ]);

  useEffect(() => {
    if (isAuthConfirmed) {
      setView('proofs');
    }
  }, [isAuthConfirmed]);

  useEffect(() => {
    if (!authReceipt?.blockNumber) return;
    const blockNumber = authReceipt.blockNumber;
    const fromBlock = blockNumber > 25n ? blockNumber - 25n : 0n;
    setProofsFromBlock(fromBlock.toString());
    setProofsToBlock(blockNumber.toString());
    if (authReceipt.status === 'reverted' || authReceipt.status === 0) {
      setProofError('Auth proof transaction reverted.');
    }
  }, [authReceipt]);

  useEffect(() => {
    setSearchMintLog(null);
    setSearchRevokeLog(null);
    setSearchError('');
  }, [verifyWallet]);

  useEffect(() => {
    if (loginDescriptor) {
      setLastLoginDescriptor(loginDescriptor);
    }
  }, [loginDescriptor]);

  useEffect(() => {
    if (view === 'profile') {
      refreshRemoteTemplate(wallet);
    }
  }, [view, wallet]);

  useEffect(() => {
    if (deviceKey) {
      sessionStorage.setItem('faceid-device-key', deviceKey);
    } else {
      sessionStorage.removeItem('faceid-device-key');
    }
  }, [deviceKey]);

  const handleWalletSearch = async () => {
    setSearchError('');
    setSearchMintLog(null);
    setSearchRevokeLog(null);
    if (!publicClient) {
      setSearchError('RPC client unavailable.');
      return;
    }
    if (!isVerifyWalletValid) {
      setSearchError('Enter a valid wallet address.');
      return;
    }
    setSearchLoading(true);
    try {
      const fetchLogs = async (fromBlock, toBlock) =>
        publicClient.getLogs({
          address: IDENTITY_CONTRACT_ADDRESS,
          event: identityMintedEvent,
          args: { owner: verifyWallet },
          fromBlock,
          toBlock,
        });
      let mintLogs = [];
      try {
        mintLogs = await fetchLogs(0n, 'latest');
      } catch (error) {
        if (!currentBlock) {
          throw error;
        }
        const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
        const fromBlock = currentBlock > windowSize ? currentBlock - windowSize : 0n;
        mintLogs = await fetchLogs(fromBlock, 'latest');
      }
      const latestMint = mintLogs[mintLogs.length - 1] || null;
      setSearchMintLog(latestMint);
      if (latestMint && verifyTokenId && verifyTokenId > 0n) {
        const revokeLogs = await publicClient.getLogs({
          address: IDENTITY_CONTRACT_ADDRESS,
          event: identityRevokedEvent,
          args: { tokenId: verifyTokenId },
          fromBlock: latestMint.blockNumber ?? 0n,
          toBlock: 'latest',
        });
        setSearchRevokeLog(revokeLogs[revokeLogs.length - 1] || null);
      }
    } catch (error) {
      setSearchError(error?.message || 'Failed to load wallet history. Check RPC or chain.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleUnlockWithWallet = async () => {
    setDeviceKeyError('');
    if (!address) {
      setDeviceKeyError('Connect your wallet to unlock the device key.');
      return;
    }
    try {
      const message = `FaceID device sync key v1:${address.toLowerCase()}`;
      const signature = await signMessageAsync({ message });
      const passphrase = await derivePassphraseFromSignature({
        signature,
        wallet: address,
      });
      setDeviceKey(passphrase);
      setDeviceKeySource('wallet');
    } catch (error) {
      setDeviceKeyError('Wallet signature rejected.');
    }
  };

  const handleClearDeviceKey = () => {
    setDeviceKey('');
    setDeviceKeySource('manual');
  };

  const handleSyncToCloud = async () => {
    setSyncStatus('');
    if (!deviceKey) {
      setSyncStatus('Set a device key before syncing.');
      return;
    }
    if (!wallet || !isWalletValid) {
      setSyncStatus('Enter a valid wallet address.');
      return;
    }
    try {
      const localEncrypted = await loadEncryptedTemplate({
        wallet,
        passphrase: deviceKey,
      });
      const localPlain = localEncrypted || loadTemplate(wallet);
      if (!localPlain) {
        setSyncStatus('No local template to sync.');
        return;
      }
      const payload = await encryptTemplate({ descriptor: localPlain, passphrase: deviceKey });
      await saveRemoteTemplate({ wallet, payload });
      await refreshRemoteTemplate(wallet);
      setSyncStatus('Synced to cloud.');
    } catch (error) {
      setSyncStatus(error?.message || 'Cloud sync failed.');
    }
  };

  const handleRestoreFromCloud = async () => {
    setSyncStatus('');
    if (!deviceKey) {
      setSyncStatus('Set a device key before restoring.');
      return;
    }
    if (!wallet || !isWalletValid) {
      setSyncStatus('Enter a valid wallet address.');
      return;
    }
    try {
      const remote = await loadRemoteTemplate({ wallet });
      if (!remote?.payload) {
        setSyncStatus('No cloud template found.');
        return;
      }
      const descriptor = await decryptTemplate({ payload: remote.payload, passphrase: deviceKey });
      await saveEncryptedTemplate({ wallet, descriptor, passphrase: deviceKey });
      setSyncStatus('Restored from cloud.');
    } catch (error) {
      setSyncStatus(error?.message || 'Cloud restore failed.');
    }
  };

  const handleGenerateAndRelayProof = async () => {
    setProofError('');
    setProofAction('');
    if (!lastLoginAt || Date.now() - lastLoginAt > LOGIN_PROOF_WINDOW_MS) {
      setProofError('Run login check within the last 5 minutes before generating a proof.');
      return;
    }
    if (lastLoginWallet && lastLoginWallet.toLowerCase() !== wallet.toLowerCase()) {
      setProofError('Login check wallet does not match the proof wallet.');
      return;
    }
    let descriptorForProof = lastMatchedTemplate;
    if (!descriptorForProof) {
      if (deviceKey) {
        const localEncrypted = await loadEncryptedTemplate({ wallet, passphrase: deviceKey });
        if (localEncrypted) {
          descriptorForProof = localEncrypted;
        } else {
          try {
            const remote = await loadRemoteTemplate({ wallet });
            if (remote?.payload) {
              descriptorForProof = await decryptTemplate({
                payload: remote.payload,
                passphrase: deviceKey,
              });
            }
          } catch (error) {
            descriptorForProof = null;
          }
        }
      } else {
        descriptorForProof = loadTemplate(wallet);
      }
    }
    if (!descriptorForProof) {
      setProofError('Run a login check to match the stored template before generating a proof.');
      return;
    }
    if (!wallet || !isWalletValid) {
      setProofError('Enter a valid wallet address.');
      return;
    }
    const storedNonce = walletIdentity?.[3];
    if (!storedNonce) {
      setProofError('On-chain nonce missing. Re-enroll identity with the new contract.');
      return;
    }
    try {
      setProofAction('Generating proof...');
      const nonce = storedNonce.toString(16);
      const commitment = await makeCommitmentFromEmbedding({
        descriptor: descriptorForProof,
        wallet,
        nonce,
      });
      const commitmentBytes32 = `0x${commitment}`;
      const { proof, publicSignals } = await generateAuthProof({
        descriptor: descriptorForProof,
        wallet,
        commitment: commitmentBytes32,
        nonce,
      });
      setProofAction('Verifying proof...');
      const isValid = await verifyAuthProof({ proof, publicSignals });
      if (!isValid) {
        setProofError('Proof verification failed. Check circuit/vkey.');
        return;
      }
      setProofAction('Submitting on-chain...');
      const { a, b, c, input } = await exportProofCalldata({ proof, publicSignals });
      writeAuthProof({
        address: IDENTITY_CONTRACT_ADDRESS,
        abi: identityAbi,
        functionName: 'submitAuthProof',
        args: [a, b, c, input],
      });
      setLastProof({
        commitment: commitmentBytes32,
        relayResult: null,
        createdAt: new Date().toISOString(),
      });
      setProofAction('Submitted.');
    } catch (error) {
      setProofError(error?.message || 'Proof generation failed.');
    }
  };

  const handleProofsPrev = () => {
    const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
    const fromBlock = parseBlockInput(proofsFromBlock) ?? 0n;
    const toBlock = parseBlockInput(proofsToBlock) ?? currentBlock;
    const nextTo = toBlock && toBlock > windowSize ? toBlock - windowSize : 0n;
    const nextFrom = nextTo > windowSize ? nextTo - windowSize : 0n;
    setProofsFromBlock(nextFrom.toString());
    setProofsToBlock(nextTo.toString());
  };

  const handleProofsNext = () => {
    const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
    const toBlock = parseBlockInput(proofsToBlock);
    const base = toBlock ?? currentBlock ?? 0n;
    const nextFrom = base + 1n;
    const nextTo = base + windowSize;
    setProofsFromBlock(nextFrom.toString());
    setProofsToBlock(nextTo.toString());
  };

  const handleProofsLatest = () => {
    if (!currentBlock) return;
    const windowSize = parseBlockInput(proofsWindowSize) ?? PROOFS_WINDOW;
    const fromBlock = currentBlock > windowSize ? currentBlock - windowSize : 0n;
    setProofsFromBlock(fromBlock.toString());
    setProofsToBlock(currentBlock.toString());
  };

  const buildCsvRow = (fields) =>
    fields
      .map((value) => {
        const safe = value === null || value === undefined ? '' : `${value}`;
        return `"${safe.replace(/\"/g, '""')}"`;
      })
      .join(',');

  const downloadCsv = (filename, rows) => {
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleDownloadCsv = async () => {
    setCsvStatus('');
    if (!publicClient) {
      setCsvStatus('RPC client unavailable.');
      return;
    }
    try {
      setCsvStatus('Preparing CSV...');
      const fromBlock = parseBlockInput(proofsFromBlock) ?? 0n;
      const toBlock = parseBlockInput(proofsToBlock);
      const [mintedLogs, revokedLogs, authLogs] = await Promise.all([
        publicClient.getLogs({
          address: IDENTITY_CONTRACT_ADDRESS,
          event: identityMintedEvent,
          fromBlock,
          toBlock: toBlock ?? 'latest',
        }),
        publicClient.getLogs({
          address: IDENTITY_CONTRACT_ADDRESS,
          event: identityRevokedEvent,
          fromBlock,
          toBlock: toBlock ?? 'latest',
        }),
        publicClient.getLogs({
          address: IDENTITY_CONTRACT_ADDRESS,
          event: authProofEvent,
          fromBlock,
          toBlock: toBlock ?? 'latest',
        }),
      ]);
      const rows = [];
      rows.push(
        buildCsvRow([
          'type',
          'wallet',
          'tokenId',
          'blockNumber',
          'txHash',
          'createdAt',
          'commitment',
          'nonce',
        ])
      );
      mintedLogs.forEach((log) => {
        rows.push(
          buildCsvRow([
            'onboard',
            log.args?.owner || '',
            log.args?.tokenId?.toString() || '',
            log.blockNumber?.toString() || '',
            log.transactionHash || '',
            '',
            log.args?.faceCommitment || '',
            '',
          ])
        );
      });
      revokedLogs.forEach((log) => {
        rows.push(
          buildCsvRow([
            'revoked',
            log.args?.owner || '',
            log.args?.tokenId?.toString() || '',
            log.blockNumber?.toString() || '',
            log.transactionHash || '',
            '',
            '',
            '',
          ])
        );
      });
      authLogs.forEach((log) => {
        rows.push(
          buildCsvRow([
            'auth',
            log.args?.owner || '',
            log.args?.tokenId?.toString() || '',
            log.blockNumber?.toString() || '',
            log.transactionHash || '',
            '',
            log.args?.commitment || '',
            log.args?.nonce?.toString() || '',
          ])
        );
      });
      downloadCsv('faceid-proof-history.csv', rows);
      setCsvStatus('CSV downloaded.');
    } catch (error) {
      setCsvStatus(error?.message || 'Failed to build CSV.');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="brand">
            <div className="logo">F</div>
            <div>
              <div className="title">FaceID SBT Identity</div>
              <div className="subtitle">
                Face-based verification, on-chain commitments, and secure session keys.
              </div>
            </div>
          </div>
        </div>
        <nav className="nav">
          {views.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button
            className={isConnected ? 'active' : ''}
            onClick={() => (isConnected ? disconnect() : open())}
            disabled={!hasProjectId}
            title={!hasProjectId ? 'Set VITE_WALLETCONNECT_PROJECT_ID to enable' : ''}
          >
            {isConnected ? 'Disconnect' : 'Connect Wallet'}
          </button>
        </nav>
      </header>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          variants={containerVariants}
          initial="hidden"
          animate="show"
          exit={{ opacity: 0, y: 20 }}
          className="grid"
        >
          {view === 'home' && (
            <>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Identity status</h3>
                <p className="subtitle">Wallet bound soulbound token for identity.</p>
                <div style={{ marginTop: 12 }}>
                  <label className="label">Active wallet</label>
                  <input
                    value={wallet}
                    onChange={(event) => setWallet(event.target.value)}
                    disabled={isConnected}
                  />
                  {!hasProjectId && (
                    <div className="subtitle" style={{ marginTop: 8 }}>
                      WalletConnect project ID missing. Add it to `web/.env`.
                    </div>
                  )}
                  {isConnected && (
                    <div className="subtitle" style={{ marginTop: 8 }}>
                      Connected on Base Sepolia (84532). Chain ID: {chainId}
                    </div>
                  )}
                  {isWalletValid && walletTokenId && walletTokenId > 0n ? (
                    <span className="badge">
                      {walletIdentity && Number(walletIdentity[1]) === 1 ? 'Revoked' : 'Verified'}
                    </span>
                  ) : (
                    <span className="badge">Not minted</span>
                  )}
                  {walletTokenId && walletTokenId > 0n && (
                    <div className="subtitle" style={{ marginTop: 8 }}>
                      Token ID: {walletTokenId.toString()}
                    </div>
                  )}
                </div>
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Trust + privacy</h3>
                <p className="subtitle">
                  We store only a face commitment on-chain. Encrypted device templates power
                  private, ZK-ready proofs.
                </p>
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  <span className="badge">Encrypted device sync</span>
                  <span className="badge">SBT enforced</span>
                  <span className="badge">ZK-friendly commitments</span>
                </div>
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Next actions</h3>
                <p className="subtitle">
                  Use the navigation above to enroll or verify wallets.
                </p>
                <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                  <button className="button secondary" onClick={() => setView('profile')}>
                    View profile
                  </button>
                  <button className="button" onClick={() => setView('enroll')}>
                    Start enrollment
                  </button>
                  <button className="button secondary" onClick={() => setView('verify')}>
                    Verify wallet
                  </button>
                  <button className="button secondary" onClick={() => setView('proofs')}>
                    Realtime proofs
                  </button>
                </div>
              </motion.div>
            </>
          )}

          {view === 'profile' && (
            <>
              <motion.div className="panel profile-card" variants={itemVariants}>
                <h3>Identity profile</h3>
                <p className="subtitle">
                  Encrypted device sync plus on-chain commitments. Your key never leaves the
                  browser.
                </p>
                <div className="range-controls" style={{ marginTop: 16 }}>
                  <div>
                    <label className="label">Window size (blocks)</label>
                    <input
                      value={proofsWindowSize}
                      onChange={(event) => setProofsWindowSize(event.target.value)}
                      placeholder={PROOFS_WINDOW.toString()}
                    />
                  </div>
                  <div>
                    <label className="label">From block</label>
                    <input
                      value={proofsFromBlock}
                      onChange={(event) => setProofsFromBlock(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="label">To block</label>
                    <input
                      value={proofsToBlock}
                      onChange={(event) => setProofsToBlock(event.target.value)}
                      placeholder="latest"
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="button secondary" onClick={handleProofsPrev}>
                    Prev window
                  </button>
                  <button className="button secondary" onClick={handleProofsNext}>
                    Next window
                  </button>
                  <button className="button secondary" onClick={handleProofsLatest}>
                    Latest window
                  </button>
                </div>
                <div className="stats-grid" style={{ marginTop: 16 }}>
                  <div className="stat">
                    <span className="stat-label">Wallet</span>
                    <span className="stat-value">
                      {isConnected && address
                        ? formatWallet(address)
                        : isWalletValid
                          ? formatWallet(wallet)
                          : 'Not connected'}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Token ID</span>
                    <span className="stat-value">
                      {walletTokenId && walletTokenId > 0n ? walletTokenId.toString() : 'Not minted'}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Status</span>
                    <span className="stat-value">
                      {walletIdentity ? (Number(walletIdentity[1]) === 0 ? 'Active' : 'Revoked') : '—'}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Chain</span>
                    <span className="stat-value">{isCorrectChain ? 'Base Sepolia' : 'Wrong network'}</span>
                  </div>
                </div>
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Device sync key</h3>
                <p className="subtitle">
                  Encrypt the face template and sync it to Supabase so you can restore on any
                  device with the same wallet key.
                </p>
                <label className="label" style={{ marginTop: 16 }}>
                  Device passphrase
                </label>
                <div className="field-row">
                  <input
                    type={deviceKeyVisible ? 'text' : 'password'}
                    value={deviceKey}
                    onChange={(event) => {
                      setDeviceKey(event.target.value);
                      setDeviceKeySource('manual');
                    }}
                    placeholder="Set a private key for encryption"
                  />
                  <button
                    className="button secondary small"
                    onClick={() => setDeviceKeyVisible((prev) => !prev)}
                  >
                    {deviceKeyVisible ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="button" onClick={handleUnlockWithWallet} disabled={isSigning}>
                    {isSigning ? 'Waiting for signature...' : 'Unlock with wallet'}
                  </button>
                  <button className="button secondary" onClick={handleClearDeviceKey}>
                    Clear key
                  </button>
                </div>
                {deviceKeyError && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    {deviceKeyError}
                  </div>
                )}
                <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span className="badge">
                    Local template: {templateStatus.encrypted ? 'Encrypted' : templateStatus.plain ? 'Plain' : 'None'}
                  </span>
                  <span className="badge">
                    Commitment: {walletIdentity ? formatCommitment(walletIdentity[0]) : 'Not minted'}
                  </span>
                  <span className="badge">
                    Cloud template: {templateStatus.remote ? 'Synced' : 'None'}
                  </span>
                  <span className="badge">Key source: {deviceKeySource}</span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="button secondary" onClick={handleSyncToCloud}>
                    Sync to cloud
                  </button>
                  <button className="button secondary" onClick={handleRestoreFromCloud}>
                    Restore from cloud
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => refreshRemoteTemplate(wallet)}
                    disabled={remoteTemplateLoading}
                  >
                    {remoteTemplateLoading ? 'Refreshing...' : 'Refresh status'}
                  </button>
                </div>
                {(remoteTemplate || remoteTemplateError) && (
                  <div className="subtitle" style={{ marginTop: 12 }}>
                    {remoteTemplate
                      ? `Cloud updated: ${remoteTemplate.updated_at || 'unknown'}`
                      : remoteTemplateError}
                  </div>
                )}
                <div className="subtitle" style={{ marginTop: 12 }}>
                  Tip: set this before enrollment to store new templates encrypted. Supabase stores
                  only the encrypted payload.
                </div>
                {syncStatus && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    {syncStatus}
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>ZKP session card</h3>
                <p className="subtitle">
                  Proofs are generated locally from the encrypted template and posted as
                  commitments.
                </p>
                <div className="list" style={{ marginTop: 16 }}>
                  <div className="session">
                    <div className="session-title">Circuit</div>
                    <div className="subtitle">face-commitment-v1 (device sync)</div>
                  </div>
                  <div className="session">
                    <div className="session-title">Proof window</div>
                    <div className="subtitle">Auth proof every 6 blocks while active</div>
                  </div>
                  <div className="session">
                    <div className="session-title">Last proof</div>
                    <div className="subtitle">{currentBlock ? `Block ${currentBlock.toString()}` : 'Waiting...'}</div>
                  </div>
                </div>
              </motion.div>
            </>
          )}

          {view === 'enroll' && (
            <>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Enroll identity</h3>
                <p className="subtitle">Live camera + blink liveness + face embedding.</p>
                <label className="label" style={{ marginTop: 16 }}>
                  Wallet address
                </label>
                <input
                  value={wallet}
                  onChange={(event) => setWallet(event.target.value)}
                  disabled={isConnected}
                />
                {isConnected &&
                  address?.toLowerCase() !== IDENTITY_OWNER_ADDRESS.toLowerCase() &&
                  address?.toLowerCase() !== wallet.toLowerCase() && (
                    <div className="subtitle" style={{ marginTop: 8 }}>
                      You can only mint for yourself unless you are the contract owner.
                    </div>
                  )}
                <div className="camera" style={{ marginTop: 16 }}>
                  <video ref={videoRef} playsInline muted autoPlay />
                  <div className="camera-overlay">
                    {modelsLoading && <div>Loading face models...</div>}
                    {cameraError && <div>{cameraError}</div>}
                    {!modelsLoading && !cameraError && (
                      <div>
                        {modelsReady ? 'Models ready' : 'Models not loaded'}
                        {' · '}
                        {enrollFaceDetected ? 'Face detected' : 'No face detected'}
                        {' · '}
                        Blinks: {enrollBlinkCount}/{REQUIRED_BLINKS}
                        {enrollLivenessPassed && ' · Liveness passed'}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                  <button className="button" onClick={() => startCamera('enroll')} disabled={cameraOn}>
                    Start camera
                  </button>
                  <button className="button secondary" onClick={stopCamera} disabled={!cameraOn}>
                    Stop camera
                  </button>
                  <button
                    className="button"
                    onClick={handleEnroll}
                    disabled={!enrollLivenessPassed || !enrollDescriptor}
                  >
                    Mint identity
                  </button>
                </div>
                {enrollError && (
                  <div style={{ marginTop: 12 }}>
                    <span className="badge">{enrollError}</span>
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Enrollment output</h3>
                {enrollResult ? (
                  <>
                    <p className="subtitle">Commitment minted.</p>
                    <div className="list" style={{ marginTop: 16 }}>
                      <div>
                        Face commitment: {enrollResult.faceCommitment?.slice(0, 34)}...
                      </div>
                      <div>Commitment version: {enrollResult.version}</div>
                      <div>Function: {enrollResult.functionName}</div>
                      <div>Target wallet: {enrollResult.targetWallet}</div>
                      {walletTokenId && walletTokenId > 0n && (
                        <div>Token ID: {walletTokenId.toString()}</div>
                      )}
                      {walletIdentity && (
                        <div>
                          Status: {Number(walletIdentity[1]) === 0 ? 'Active' : 'Revoked'}
                        </div>
                      )}
                      {pendingCommitment && (
                        <div>Pending commitment: {pendingCommitment.slice(0, 34)}...</div>
                      )}
                      {txHash && <div>Tx hash: {txHash}</div>}
                      {isPending && <div>Submitting transaction...</div>}
                      {isConfirming && <div>Waiting for confirmation...</div>}
                      {isConfirmed && <div>Mint confirmed on-chain.</div>}
                      {txReceipt && (
                        <div>
                          Receipt status: {txReceipt.status} · Logs: {txReceipt.logs.length}
                        </div>
                      )}
                      {!contractHasCode && (
                        <div>
                          Warning: No contract code found at {IDENTITY_CONTRACT_ADDRESS}.
                        </div>
                      )}
                      {txReceipt && txReceipt.logs.length === 0 && (
                        <div>
                          Warning: Transaction emitted no logs. Check contract address and chain.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="subtitle">Run liveness to mint your identity SBT.</p>
                )}
              </motion.div>
            </>
          )}

          {view === 'verify' && (
            <>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Wallet verification</h3>
                <p className="subtitle">Check if a wallet owns an active identity.</p>
                <label className="label" style={{ marginTop: 16 }}>
                  Wallet address
                </label>
                <input
                  value={verifyWallet}
                  onChange={(event) => setVerifyWallet(event.target.value)}
                />
                {verifyResult && (
                  <div style={{ marginTop: 12 }}>
                    <span className="badge">{verifyResult}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    className="button secondary"
                    onClick={() => {
                      refetchVerifyTokenId();
                      refetchVerifyIdentity();
                    }}
                  >
                    Refresh on-chain
                  </button>
                  <button className="button" onClick={handleWalletSearch} disabled={searchLoading}>
                    {searchLoading ? 'Searching...' : 'Search wallet'}
                  </button>
                </div>
                {(verifyTokenError || verifyIdentityError) && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    On-chain read error. Check chain and contract address.
                  </div>
                )}
                {verifyTokenId && verifyTokenId > 0n && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    Token ID: {verifyTokenId.toString()} · Status:{' '}
                    {verifyIdentity ? (Number(verifyIdentity[1]) === 0 ? 'Active' : 'Revoked') : '...'}
                  </div>
                )}
                {searchError && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    {searchError}
                  </div>
                )}
                {searchMintLog && (
                  <div className="list" style={{ marginTop: 16 }}>
                    <div>
                      Mint block: {searchMintLog.blockNumber?.toString() || 'Unknown'} - Blocks
                      since: {blockAge(searchMintLog.blockNumber) ?? 'N/A'}
                    </div>
                    <div>Mint tx: {searchMintLog.transactionHash}</div>
                    <div>Token ID: {searchMintLog.args?.tokenId?.toString() || 'N/A'}</div>
                    <div>Owner: {searchMintLog.args?.owner || verifyWallet}</div>
                    {searchRevokeLog && (
                      <div>
                        Revoked in block: {searchRevokeLog.blockNumber?.toString() || 'Unknown'}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Verification policy</h3>
                <p className="subtitle">
                  Apps can query face commitment status to gate actions.
                </p>
                <div style={{ marginTop: 16 }}>
                  <div className="badge">Active SBT</div>
                </div>
              </motion.div>
            </>
          )}


          {view === 'proofs' && (
            <>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Realtime proofs</h3>
                <p className="subtitle">
                  Live auth and onboarding events from the identity contract, streamed per block.
                </p>
                <div className="stats-grid" style={{ marginTop: 16 }}>
                  <div className="stat">
                    <span className="stat-label">Verified wallets</span>
                    <span className="stat-value">{totalVerified ?? 'N/A'}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Onboarded (window)</span>
                    <span className="stat-value">{proofsSummary.minted}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Revoked (window)</span>
                    <span className="stat-value">{proofsSummary.revoked}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Auth proofs (window)</span>
                    <span className="stat-value">{proofsSummary.auth}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Block window</span>
                    <span className="stat-value">{PROOFS_WINDOW.toString()}</span>
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span className="badge">Contract: {formatWallet(IDENTITY_CONTRACT_ADDRESS)}</span>
                  <span className="badge">Chain: Base Sepolia</span>
                  <span className="badge">Head: {currentBlock ? currentBlock.toString() : 'N/A'}</span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="button secondary" onClick={handleDownloadCsv}>
                    Download CSV
                  </button>
                </div>
                {csvStatus && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    {csvStatus}
                  </div>
                )}
                {proofsError && (
                  <div className="subtitle" style={{ marginTop: 12 }}>
                    {proofsError}
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Proof stream</h3>
                <p className="subtitle">Realtime wallet events, newest first.</p>
                <div className="table" style={{ marginTop: 16 }}>
                  <div className="table-row table-head">
                    <span>Type</span>
                    <span>Wallet</span>
                    <span>Token</span>
                    <span>Block</span>
                    <span>Tx</span>
                  </div>
                  {proofsLoading && <div className="subtitle">Loading proofs...</div>}
                  {!proofsLoading && proofsFeed.length === 0 && (
                    <div className="subtitle">No proofs in this window yet.</div>
                  )}
                  {!proofsLoading &&
                    proofsFeed.map((item) => (
                      <div className="table-row" key={`${item.txHash}-${item.type}`}>
                        <span className={`pill ${item.type}`}>{item.type}</span>
                        <span>{item.wallet ? formatWallet(item.wallet) : 'Unknown'}</span>
                        <span>{item.tokenId ? item.tokenId.toString() : 'N/A'}</span>
                        <span>
                          {item.blockNumber
                            ? item.blockNumber.toString()
                            : item.createdAt
                              ? 'Offchain'
                              : 'N/A'}
                          {blockAge(item.blockNumber) !== null && (
                            <em> - {blockAge(item.blockNumber)} blocks ago</em>
                          )}
                        </span>
                        <span>{item.txHash ? formatWallet(item.txHash) : 'Unknown'}</span>
                      </div>
                    ))}
                </div>
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Realtime auth intent</h3>
                <p className="subtitle">
                  Device sync proofs can be posted here when ZKP circuits are wired to the relayer.
                </p>
                <div className="list" style={{ marginTop: 16 }}>
                  <div className="session">
                    <div className="session-title">Auth type</div>
                    <div className="subtitle">Face commitment match</div>
                  </div>
                  <div className="session">
                    <div className="session-title">Relay status</div>
                    <div className="subtitle">
                      {proofAction ||
                        (isAuthPending
                          ? 'Submitting proof...'
                          : isAuthConfirming
                            ? 'Waiting for confirmation...'
                            : isAuthConfirmed
                              ? 'Confirmed on-chain'
                              : 'Awaiting proof submission')}
                    </div>
                  </div>
                  <div className="session">
                    <div className="session-title">Last proof</div>
                    <div className="subtitle">
                      {lastProof ? `${lastProof.commitment.slice(0, 10)}...` : 'None'}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button className="button" onClick={handleGenerateAndRelayProof}>
                    Generate + relay proof
                  </button>
                </div>
                {authTxHash && (
                  <div className="subtitle" style={{ marginTop: 12 }}>
                    Auth tx: {authTxHash}
                  </div>
                )}
                {authReceipt && (
                  <div className="subtitle" style={{ marginTop: 8 }}>
                    Auth tx status: {authReceipt.status === 'success' || authReceipt.status === 1 ? 'Success' : 'Reverted'}
                  </div>
                )}
                {lastProof && (
                  <div className="subtitle" style={{ marginTop: 12 }}>
                    Commitment: {lastProof.commitment.slice(0, 12)}...
                  </div>
                )}
                {proofError && (
                  <div className="subtitle" style={{ marginTop: 12 }}>
                    {proofError}
                  </div>
                )}
              </motion.div>
            </>
          )}

          {view === 'login' && (
            <>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Login check</h3>
                <p className="subtitle">
                  Re-scan the face to confirm the wallet owner matches the enrollment.
                </p>
                <label className="label" style={{ marginTop: 16 }}>
                  Wallet address
                </label>
                <input
                  value={wallet}
                  onChange={(event) => setWallet(event.target.value)}
                  disabled={isConnected}
                />
                <div className="camera" style={{ marginTop: 16 }}>
                  <video ref={videoRef} playsInline muted autoPlay />
                  <div className="camera-overlay">
                    {modelsLoading && <div>Loading face models...</div>}
                    {cameraError && <div>{cameraError}</div>}
                    {!modelsLoading && !cameraError && (
                      <div>
                        {modelsReady ? 'Models ready' : 'Models not loaded'}
                        {' · '}
                        {loginFaceDetected ? 'Face detected' : 'No face detected'}
                        {' · '}
                        Blinks: {loginBlinkCount}/{REQUIRED_BLINKS}
                        {loginLivenessPassed && ' · Liveness passed'}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                  <button className="button" onClick={() => startCamera('login')} disabled={cameraOn}>
                    Start camera
                  </button>
                  <button className="button secondary" onClick={stopCamera} disabled={!cameraOn}>
                    Stop camera
                  </button>
                  <button
                    className="button"
                    onClick={handleLoginCheck}
                    disabled={!loginLivenessPassed || !loginDescriptor}
                  >
                    Verify login
                  </button>
                </div>
                {loginResult && (
                  <div style={{ marginTop: 12 }}>
                    <span className="badge">{loginResult}</span>
                    {loginScore !== null && (
                      <div className="subtitle" style={{ marginTop: 6 }}>
                        Distance score: {loginScore.toFixed(3)} (threshold {MATCH_THRESHOLD})
                      </div>
                    )}
                  </div>
                )}
                {loginMatched && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button className="button" onClick={handleGenerateAndRelayProof}>
                      Submit auth proof on-chain
                    </button>
                    <div className="subtitle" style={{ alignSelf: 'center' }}>
                      Proof submission requires a wallet confirmation.
                    </div>
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>On-device match</h3>
                <p className="subtitle">
                  Login uses the encrypted cloud template (Supabase) when a device key is set. The
                  browser keeps only a cached encrypted copy, while on-chain data holds the
                  commitment.
                </p>
                <div style={{ marginTop: 16 }}>
                  <div className="badge">Local template store</div>
                </div>
              </motion.div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="footer">
        Privacy-first identity verification on Base Sepolia.
      </div>
    </div>
  );
}
