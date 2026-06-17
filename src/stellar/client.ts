import {
  rpc,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  Account,
} from '@stellar/stellar-sdk';
import { config } from '../config';
import { HttpClientAdapter, TimeoutError } from '../utils/http-client';
import { logger } from '../utils/logger';
import { TransactionResult } from './types';

export const stellarHttpClient = new HttpClientAdapter({
  timeoutMs: config.httpClient.timeoutMs,
  maxRetries: config.httpClient.maxRetries,
  baseDelayMs: config.httpClient.baseDelayMs,
  maxDelayMs: config.httpClient.maxDelayMs,
  circuitBreakerThreshold: config.httpClient.circuitBreakerThreshold,
  circuitBreakerResetMs: config.httpClient.circuitBreakerResetMs,
})

export function resolveNetworkPassphrase(network: string | undefined): string {
  switch (network?.toLowerCase()) {
    case 'mainnet':
      return Networks.PUBLIC;
    case 'testnet':
      return Networks.TESTNET;
    case 'futurenet':
      return Networks.FUTURENET;
    default:
      throw new Error(
        `Unknown STELLAR_NETWORK: "${network}". Expected "mainnet", "testnet", or "futurenet".`
      );
  }
}

const RPC_URL = config.stellar.rpcUrl;
const NETWORK_PASSPHRASE = resolveNetworkPassphrase(config.stellar.network);

let agentKeypair: Keypair | null = null;
let rpcServer: rpc.Server | null = null;

export function getRpcServer(): rpc.Server {
  if (!rpcServer) {
    rpcServer = new rpc.Server(RPC_URL);
  }
  return rpcServer;
}

export function getNetworkPassphrase(): string {
  return NETWORK_PASSPHRASE;
}

export function getAgentKeypair(): Keypair {
  if (!agentKeypair) {
    const secret = process.env.STELLAR_AGENT_SECRET_KEY;
    if (!secret) {
      throw new Error('STELLAR_AGENT_SECRET_KEY not configured');
    }
    agentKeypair = Keypair.fromSecret(secret);
  }
  return agentKeypair;
}

export async function submitTransaction(tx: Transaction): Promise<string> {
  const server = getRpcServer();

  return stellarHttpClient.execute(async () => {
    try {
      const response = await server.sendTransaction(tx);

      if (response.status === 'ERROR') {
        throw new Error(`Transaction failed: ${response.errorResult?.toXDR('base64')}`);
      }

      return response.hash;
    } catch (error) {
      if (error instanceof TimeoutError) throw error
      throw new Error(`Failed to submit transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, 'stellar.submitTransaction')
}

/**
 * Simulate a transaction against the Stellar RPC with retry/timeout/circuit-breaker.
 */
export async function simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
  const server = getRpcServer()
  return stellarHttpClient.execute(() => server.simulateTransaction(tx), 'stellar.simulateTransaction')
}

/**
 * Prepare a transaction (add fee-bump etc.) with retry/timeout/circuit-breaker.
 */
export async function prepareTransaction(tx: Transaction): Promise<Transaction> {
  const server = getRpcServer()
  return stellarHttpClient.execute(() => server.prepareTransaction(tx), 'stellar.prepareTransaction')
}

/**
 * Get account details from the Stellar RPC with retry/timeout/circuit-breaker.
 */
export async function getAccount(publicKey: string): Promise<Account> {
  const server = getRpcServer()
  return stellarHttpClient.execute(() => server.getAccount(publicKey), 'stellar.getAccount')
}

export async function waitForConfirmation(
  txHash: string,
  timeoutMs: number = 30000
): Promise<TransactionResult> {
  const server = getRpcServer();
  const pollDeadline = Date.now() + timeoutMs;

  const poll = async (): Promise<TransactionResult> => {
    const response = await server.getTransaction(txHash);

    if (response.status === 'SUCCESS') {
      return {
        hash: txHash,
        status: 'success',
        ledger: response.ledger,
      };
    }

    if (response.status === 'FAILED') {
      return {
        hash: txHash,
        status: 'failed',
      };
    }

    if (Date.now() >= pollDeadline) {
      throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    return poll()
  }

  return stellarHttpClient.execute(poll, 'stellar.waitForConfirmation')
}
