import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { mainnet, localhost } from "viem/chains";
import dotenv from "dotenv";
import { abi } from "./utils/contract-metadata.js";
import { writeAuditLog } from "./utils/logs.js";

dotenv.config();

const client = createPublicClient({
  chain: localhost,
  transport: http(),
});

const MedVault_SC_Address: `0x${string}` = process.env
  .MEDIVAULT_SC_ADDRESS! as `0x${string}`;

export async function isContractLive(address: `0x${string}`) {
  try {
    const bytecode = await client.getCode({ address });

    if (bytecode && bytecode !== "0x") {
      return { message: "contract is live", address };
    } else {
      return { message: "contract is not live" };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "unexpected error",
    };
  }
}

// ── mintRecord ────────────────────────────────────────────────────────────────
// Contract expects: (patient, cid, fileHash bytes32)
// metadata is for audit log only

export async function mintRecord(
  patientAddress: string,
  cid: string,
  fileHash: `0x${string}`,
  metadata: {
    recordType: string;
    doctorId:   string;
  },
  account: `0x${string}`,
  user_id: string,
) {
  const walletClient = createWalletClient({
    account,
    chain: localhost,
    transport: http(),
  });

  try {
    const { request } = await client.simulateContract({
      account,
      address:      MedVault_SC_Address,
      abi:          abi,
      functionName: "mintRecord",
      args:         [patientAddress, cid, fileHash],
    });

    const hash    = await walletClient.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (!receipt) throw new Error("Minted error");

    // ── Audit: MINT_SUCCESS ─────────────────────────────────────────
    await writeAuditLog({
      event:               "MINT_SUCCESS",
      user_id,
      actor_address:       account,
      patient_address:     patientAddress,
      blockchain_txn_hash: hash,
      metadata: {
        block_number: Number(receipt.blockNumber),
        recordType:   metadata.recordType,
        doctorId:     metadata.doctorId,
      },
    });

    return {
      message: "successfully uploaded file, minted nft",
      receipt,
      hash,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unexpected error";

    // ── Audit: MINT_FAILURE ─────────────────────────────────────────
    await writeAuditLog({
      event:           "MINT_FAILURE",
      user_id,
      actor_address:   account,
      patient_address: patientAddress,
      error_message:   errorMessage,
      metadata: {
        recordType: metadata.recordType,
        doctorId:   metadata.doctorId,
      },
    });

    console.error(err);
    return { error: errorMessage };
  }
}

// ── accessGrant ───────────────────────────────────────────────────────────────
// user_id: the Supabase profiles UUID of the caller — required for audit FK

export async function accessGrant(
  tokenId:       number,
  doctorAddress: string,
  account:       `0x${string}`,
  duration:      number,
  user_id:       string,       // ← Supabase profiles UUID (added for audit log)
) {
  const walletClient = createWalletClient({
    account,
    chain: localhost,
    transport: http(),
  });

  try {
    const { request } = await client.simulateContract({
      account,
      address:      MedVault_SC_Address,
      abi:          abi,
      functionName: "grantViewerRole",
      args:         [tokenId, doctorAddress, duration],
    });

    const hash    = await walletClient.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (!receipt) throw new Error("Unable to write contract");

    // ── Audit: ACCESS_GRANT_SUCCESS ─────────────────────────────────
    await writeAuditLog({
      event:               "ACCESS_GRANT_SUCCESS",
      user_id,
      actor_address:       account,
      doctor_address:      doctorAddress,
      token_id:            tokenId,
      blockchain_txn_hash: hash,
      metadata: {
        block_number:     Number(receipt.blockNumber),
        duration_seconds: duration,
        expires_at:       Math.floor(Date.now() / 1000) + duration,
      },
    });

    return {
      message: "successfully granted access",
      receipt,
      hash,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unexpected error";

    // ── Audit: ACCESS_GRANT_FAILURE ─────────────────────────────────
    await writeAuditLog({
      event:          "ACCESS_GRANT_FAILURE",
      user_id,
      actor_address:  account,
      doctor_address: doctorAddress,
      token_id:       tokenId,
      error_message:  errorMessage,
      metadata: {
        duration_seconds: duration,
      },
    });

    console.error(err);
    return { error: errorMessage };
  }
}

/**
 * Checks if a specific doctor has access to a medical record NFT.
 * Read-only — no audit log needed.
 */
export async function getRecordAccess(tokenId: number, doctorAddress: string) {
  try {
    const validatedDoctor = getAddress(doctorAddress);

    const hasAccess = await client.readContract({
      address:      MedVault_SC_Address,
      abi:          abi,
      functionName: "hasAccess",
      args:         [BigInt(tokenId), validatedDoctor],
    });

    return { success: true, hasAccess };
  } catch (err) {
    console.error("Contract Read Error:", err);
    return {
      success:   false,
      hasAccess: false,
      error:     err instanceof Error ? err.message : "Unexpected error",
    };
  }
}