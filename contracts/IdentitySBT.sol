// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IFaceVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[2] calldata input
    ) external view returns (bool);
}

/// @title IdentitySBT
/// @notice Soulbound identity token storing a face commitment on Base.
contract IdentitySBT is ERC721, Ownable {
    enum Status {
        Active,
        Revoked
    }

    struct Identity {
        bytes32 faceCommitment;
        Status status;
        uint32 version;
    }

    uint256 public nextTokenId = 1;
    address public verifier;
    uint256 public distanceThreshold = 25_000_000;
    mapping(address => uint256) public walletToTokenId;
    mapping(uint256 => Identity) public identities;

    event IdentityMinted(address indexed owner, uint256 indexed tokenId, bytes32 faceCommitment);
    event IdentityRevoked(address indexed owner, uint256 indexed tokenId);
    event VerifierUpdated(address indexed verifier);
    event DistanceThresholdUpdated(uint256 distanceThreshold);

    constructor(address initialOwner) ERC721("FaceID SBT Identity", "FACEID") Ownable(initialOwner) {}

    function setVerifier(address newVerifier) external onlyOwner {
        require(newVerifier != address(0), "invalid verifier");
        verifier = newVerifier;
        emit VerifierUpdated(newVerifier);
    }

    function setDistanceThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold != 0, "invalid threshold");
        distanceThreshold = newThreshold;
        emit DistanceThresholdUpdated(newThreshold);
    }

    function mint(address to, bytes32 faceCommitment) external onlyOwner returns (uint256 tokenId) {
        return _mintIdentity(to, faceCommitment);
    }

    function mintSelf(bytes32 faceCommitment) external returns (uint256 tokenId) {
        return _mintIdentity(msg.sender, faceCommitment);
    }

    function _mintIdentity(address to, bytes32 faceCommitment) internal returns (uint256 tokenId) {
        require(to != address(0), "invalid address");
        require(walletToTokenId[to] == 0, "wallet already has identity");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);

        identities[tokenId] = Identity({
            faceCommitment: faceCommitment,
            status: Status.Active,
            version: 1
        });
        walletToTokenId[to] = tokenId;

        emit IdentityMinted(to, tokenId, faceCommitment);
    }

    function revoke(uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(_isAuthorized(tokenOwner, msg.sender, tokenId) || msg.sender == owner(), "not authorized");
        Identity storage record = identities[tokenId];
        require(record.status == Status.Active, "already revoked");
        record.status = Status.Revoked;

        emit IdentityRevoked(tokenOwner, tokenId);
    }

    function getIdentity(address wallet)
        external
        view
        returns (uint256 tokenId, bytes32 faceCommitment, Status status, uint32 version)
    {
        tokenId = walletToTokenId[wallet];
        require(tokenId != 0, "identity not found");
        Identity memory record = identities[tokenId];
        return (tokenId, record.faceCommitment, record.status, record.version);
    }

    function verifyFaceProof(
        uint256 tokenId,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external view returns (bool) {
        require(tokenId != 0 && tokenId < nextTokenId, "identity not found");
        Identity memory record = identities[tokenId];
        require(record.status == Status.Active, "identity not active");
        require(verifier != address(0), "verifier not set");
        require(distanceThreshold != 0, "threshold not set");
        uint256[2] memory input = [uint256(record.faceCommitment), distanceThreshold];
        return IFaceVerifier(verifier).verifyProof(a, b, c, input);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("Soulbound: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }
}
