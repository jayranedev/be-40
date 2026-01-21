import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useChainId, useDisconnect, usePublicClient, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { isAddress } from 'viem';
import * as faceapi from 'face-api.js';
import '@tensorflow/tfjs-backend-webgl';
import { setBackend } from '@tensorflow/tfjs-core';
import { makeCommitmentFromEmbedding, randomHex } from './lib/crypto.js';
import { hasProjectId } from './wallet.js';
import { identityAbi } from './lib/identityAbi.js';
import { BASE_SEPOLIA_CHAIN_ID, IDENTITY_CONTRACT_ADDRESS, IDENTITY_OWNER_ADDRESS } from './lib/contract.js';
import { loadTemplate, saveTemplate } from './lib/biometricStore.js';
import { DISTANCE_THRESHOLD, MATCH_THRESHOLD } from './lib/zkConfig.js';
import { formatProofForSolidity, generateFaceProof } from './lib/zkProof.js';

const views = [
  { id: 'home', label: 'Landing' },
  { id: 'enroll', label: 'Enroll' },
  { id: 'login', label: 'Login Check' },
  { id: 'verify', label: 'Verify Wallet' },
];

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
  const [loginResult, setLoginResult] = useState('');
  const [loginScore, setLoginScore] = useState(null);
  const [zkResult, setZkResult] = useState('');
  const [zkPending, setZkPending] = useState(false);
  const [enrollTemplate, setEnrollTemplate] = useState(null);
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
  const isCorrectChain = chainId === BASE_SEPOLIA_CHAIN_ID;
  const publicClient = usePublicClient();
  const [contractHasCode, setContractHasCode] = useState(true);

  useEffect(() => {
    if (address) {
      setWallet(address);
    }
  }, [address]);

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

  const { data: onchainDistanceThreshold } = useReadContract({
    address: IDENTITY_CONTRACT_ADDRESS,
    abi: identityAbi,
    functionName: 'distanceThreshold',
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const {
    data: txReceipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  useEffect(() => {
    if (isConfirmed) {
      refetchWalletTokenId();
      refetchWalletIdentity();
    }
  }, [isConfirmed, refetchWalletTokenId, refetchWalletIdentity]);

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
      setZkResult('');
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
      nonce,
      version: 1,
    });
    const commitmentBytes32 = `0x${commitment}`;
    setPendingCommitment(commitmentBytes32);
    try {
      const sameWallet = address?.toLowerCase() === wallet.toLowerCase();
      writeContract({
        address: IDENTITY_CONTRACT_ADDRESS,
        abi: identityAbi,
        functionName: sameWallet ? 'mintSelf' : 'mint',
        args: sameWallet ? [commitmentBytes32] : [wallet, commitmentBytes32],
      });
      setEnrollResult({
        faceCommitment: commitmentBytes32,
        version: 1,
        functionName: sameWallet ? 'mintSelf' : 'mint',
        targetWallet: wallet,
      });
      setEnrollWallet(wallet);
      setEnrollTemplate({ descriptor: enrollDescriptor, nonce, version: 1 });
    } catch (error) {
      setEnrollError(error?.shortMessage || 'Transaction failed to submit.');
    }
  };

  useEffect(() => {
    if (isConfirmed && enrollWallet && enrollTemplate) {
      saveTemplate(enrollWallet, enrollTemplate);
    }
  }, [isConfirmed, enrollWallet, enrollTemplate]);

  const handleLoginCheck = () => {
    setLoginResult('');
    setLoginScore(null);
    if (!loginDescriptor) {
      setLoginResult('Complete liveness and capture a face first.');
      return;
    }
    const stored = loadTemplate(wallet);
    if (!stored?.descriptor) {
      setLoginResult('No enrolled template found for this wallet.');
      return;
    }
    const distance = faceapi.euclideanDistance(loginDescriptor, stored.descriptor);
    setLoginScore(distance);
    if (distance <= MATCH_THRESHOLD) {
      setLoginResult('Match confirmed. Same person.');
    } else {
      setLoginResult('No match. Face does not match the enrolled owner.');
    }
  };

  const handleZkVerify = async () => {
    setZkResult('');
    if (!isConnected) {
      setZkResult('Connect your wallet before verifying a proof.');
      return;
    }
    if (!isCorrectChain) {
      setZkResult('Switch to Base Sepolia (84532) before verifying a proof.');
      return;
    }
    if (!loginDescriptor) {
      setZkResult('Complete liveness and capture a face first.');
      return;
    }
    const stored = loadTemplate(wallet);
    if (!stored?.descriptor || !stored.nonce) {
      setZkResult('Missing enrolled template or nonce for this wallet.');
      return;
    }
    if (!walletTokenId || walletTokenId === 0n) {
      setZkResult('No on-chain identity found for this wallet.');
      return;
    }
    if (!publicClient) {
      setZkResult('No public client available for verification.');
      return;
    }
    setZkPending(true);
    try {
      const threshold =
        onchainDistanceThreshold && onchainDistanceThreshold > 0n
          ? onchainDistanceThreshold
          : DISTANCE_THRESHOLD;
      const { proof } = await generateFaceProof({
        liveDescriptor: loginDescriptor,
        enrolledDescriptor: stored.descriptor,
        nonce: stored.nonce,
        version: stored.version ?? 1,
        distanceThreshold: threshold,
      });
      const { a, b, c } = formatProofForSolidity(proof);
      const verified = await publicClient.readContract({
        address: IDENTITY_CONTRACT_ADDRESS,
        abi: identityAbi,
        functionName: 'verifyFaceProof',
        args: [walletTokenId, a, b, c],
      });
      setZkResult(verified ? 'ZK proof verified on-chain.' : 'ZK proof verification failed.');
    } catch (error) {
      setZkResult(error?.shortMessage || error?.message || 'Failed to verify ZK proof.');
    } finally {
      setZkPending(false);
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
                  We store only a face commitment on-chain. Liveness proves a real human is
                  present.
                </p>
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  <span className="badge">Cancelable transforms</span>
                  <span className="badge">SBT enforced</span>
                  <span className="badge">On-chain verification</span>
                </div>
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>Next actions</h3>
                <p className="subtitle">
                  Use the navigation above to enroll or verify wallets.
                </p>
                <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                  <button className="button" onClick={() => setView('enroll')}>
                    Start enrollment
                  </button>
                  <button className="button secondary" onClick={() => setView('verify')}>
                    Verify wallet
                  </button>
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
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <button
                    className="button secondary"
                    onClick={() => {
                      refetchVerifyTokenId();
                      refetchVerifyIdentity();
                    }}
                  >
                    Refresh on-chain
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
                  <button
                    className="button secondary"
                    onClick={handleZkVerify}
                    disabled={!loginLivenessPassed || !loginDescriptor || zkPending}
                  >
                    {zkPending ? 'Verifying ZK proof...' : 'Verify with ZK'}
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
                {zkResult && (
                  <div style={{ marginTop: 12 }}>
                    <span className="badge">{zkResult}</span>
                  </div>
                )}
              </motion.div>
              <motion.div className="panel" variants={itemVariants}>
                <h3>On-device match</h3>
                <p className="subtitle">
                  The face template is stored locally in this browser. On-chain data still only holds
                  the commitment.
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
