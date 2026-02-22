import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { mainnet, localhost } from "viem/chains";
import dotenv from "dotenv";
import { abi } from "./utils/contract-metadata.js";

dotenv.config();

const client = createPublicClient({
  chain: localhost,
  transport: http(),
});

const MedVault_SC_Address: `0x${string}` = process.env
  .MEDIVAULT_SC_ADDRESS! as `0x${string}`;

export async function isContractLive(address: `0x${string}`) {
  try {
    // getBytecode returns the compiled code at the address
    const bytecode = await client.getCode({
      address: address,
    });

    // If bytecode is undefined or '0x', no contract is deployed there
    if (bytecode && bytecode !== "0x") {
      return {
        message: "contract is live",
        address: address,
      };
    } else {
      return {
        message: "contract is not live",
      };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "unexpected error",
    };
  }
}

export async function mintRecord(
  patientAddress: string,
  encryptedPayload: string,
  metadata: {
    recordType: string;
    doctorId: string;
  },
  account: `0x${string}`,
) {
  const walletClient = createWalletClient({
    account,
    chain: localhost,
    transport: http(),
  });
  try {
    // upload hash to ipfs
    let cid; // returned from ipfs upload
    const { request } = await client.simulateContract({
      account,
      address: MedVault_SC_Address,
      abi: abi,
      functionName: "mintRecord",
      args: [patientAddress, encryptedPayload, metadata],
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (!receipt) throw new Error("Minted error");
    return {
      message: "successfully uploaded file, minted nft",
      receipt: receipt,
      hash: hash,
    };
  } catch (err) {
    console.error(err);
    return {
      error: err instanceof Error ? err.message : "unexpected error",
    };
  }
}

export async function accessGrant(
  tokenId: number,
  doctorAddress: string,
  account: `0x${string}`,
  duration: number,
) {
  const walletClient = createWalletClient({
    account,
    chain: localhost,
    transport: http(),
  });

  try {
    const { request } = await client.simulateContract({
      account,
      address: MedVault_SC_Address,
      abi: abi,
      functionName: "grantViewerRole",
      args: [tokenId, doctorAddress, duration],
    });

    const hash = await walletClient.writeContract(request);

    const receipt = await client.waitForTransactionReceipt({ hash });
    if (!receipt) throw new Error("Unable to write contract ");

    return {
      message: "successfully granted access",
      receipt: receipt,
      hash: hash,
    };
  } catch (err) {
    console.error(err);
    return {
      error: err instanceof Error ? err.message : "unexpected error",
    };
  }
}

/**
 * Checks if a specific doctor has access to a medical record NFT.
 * @param tokenId - The ID of the record (converted to BigInt internally)
 * @param doctorAddress - The wallet address of the doctor
 */
export async function getRecordAccess(tokenId: number, doctorAddress: string) {
  try {
    // Validate and checksum the address to satisfy viem's 0x${string} requirement
    const validatedDoctor = getAddress(doctorAddress);

    // 2. Call the 'hasAccess' view function
    const hasAccess = await client.readContract({
      address: MedVault_SC_Address,
      abi: abi,
      functionName: "hasAccess",
      args: [BigInt(tokenId), validatedDoctor],
    });

    return {
      success: true,
      hasAccess, // Returns boolean
    };
  } catch (err) {
    console.error("Contract Read Error:", err);
    return {
      success: false,
      hasAccess: false,
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}
