// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Groth16Verifier} from "./FaceAuthVerifier.sol";

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
        uint256 nonce;
    }

    uint256 public nextTokenId = 1;
    mapping(address => uint256) public walletToTokenId;
    mapping(uint256 => Identity) public identities;

    event IdentityMinted(
        address indexed owner,
        uint256 indexed tokenId,
        bytes32 faceCommitment,
        uint256 nonce
    );
    event IdentityRevoked(address indexed owner, uint256 indexed tokenId);
    event AuthProofSubmitted(
        address indexed owner,
        uint256 indexed tokenId,
        bytes32 commitment,
        uint256 nonce
    );

    Groth16Verifier public verifier;

    constructor(address initialOwner, address verifierAddress)
        ERC721("FaceID SBT Identity", "FACEID")
        Ownable(initialOwner)
    {
        verifier = Groth16Verifier(verifierAddress);
    }

    function mint(address to, bytes32 faceCommitment, uint256 nonce)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        return _mintIdentity(to, faceCommitment, nonce);
    }

    function mintSelf(bytes32 faceCommitment, uint256 nonce) external returns (uint256 tokenId) {
        return _mintIdentity(msg.sender, faceCommitment, nonce);
    }

    function _mintIdentity(address to, bytes32 faceCommitment, uint256 nonce)
        internal
        returns (uint256 tokenId)
    {
        require(to != address(0), "invalid address");
        require(walletToTokenId[to] == 0, "wallet already has identity");

        tokenId = nextTokenId++;
        _safeMint(to, tokenId);

        identities[tokenId] = Identity({
            faceCommitment: faceCommitment,
            status: Status.Active,
            version: 1,
            nonce: nonce
        });
        walletToTokenId[to] = tokenId;

        emit IdentityMinted(to, tokenId, faceCommitment, nonce);
    }

    function revoke(uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(_isAuthorized(tokenOwner, msg.sender, tokenId) || msg.sender == owner(), "not authorized");
        Identity storage record = identities[tokenId];
        require(record.status == Status.Active, "already revoked");
        record.status = Status.Revoked;

        emit IdentityRevoked(tokenOwner, tokenId);
    }

    function submitAuthProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external returns (bool) {
        uint256 tokenId = walletToTokenId[msg.sender];
        require(tokenId != 0, "identity not found");
        require(input[0] == uint256(uint160(msg.sender)), "wallet mismatch");
        require(
            identities[tokenId].faceCommitment == bytes32(input[2]),
            "commitment mismatch"
        );
        require(identities[tokenId].nonce == input[1], "nonce mismatch");
        bool ok = verifier.verifyProof(a, b, c, input);
        require(ok, "invalid proof");

        emit AuthProofSubmitted(msg.sender, tokenId, bytes32(input[2]), input[1]);
        return true;
    }

    function getIdentity(address wallet)
        external
        view
        returns (uint256 tokenId, bytes32 faceCommitment, Status status, uint32 version, uint256 nonce)
    {
        tokenId = walletToTokenId[wallet];
        require(tokenId != 0, "identity not found");
        Identity memory record = identities[tokenId];
        return (tokenId, record.faceCommitment, record.status, record.version, record.nonce);
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
