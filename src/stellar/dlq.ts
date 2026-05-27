import * as fs from 'fs'
import * as path from 'path'
import { xdr } from '@stellar/stellar-sdk'
import { logger } from '../utils/logger'

export interface DeadLetterEvent {
  id: string
  contractId: string
  txHash: string
  eventType: string
  ledger: number
  error: string
  payload: any
  status: 'PENDING' | 'RETRIED' | 'RESOLVED'
  retryCount: number
  createdAt: string
  updatedAt: string
}

const DLQ_FILE = path.join(__dirname, '../../logs/dead_letter_queue.json')

export class DeadLetterQueue {
  private static serializeScVal(value: unknown): string | unknown {
    if (value instanceof xdr.ScVal) {
      return value.toXDR('base64')
    }

    return value
  }

  private static deserializeScVal(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value
    }

    try {
      return xdr.ScVal.fromXDR(value, 'base64')
    } catch {
      return value
    }
  }

  private static serializePayload(event: any): any {
    return {
      ...event,
      topics: Array.isArray(event?.topics)
        ? event.topics.map((topic: unknown) => this.serializeScVal(topic))
        : event?.topics,
      value: this.serializeScVal(event?.value),
    }
  }

  private static deserializePayload(event: any): any {
    return {
      ...event,
      topics: Array.isArray(event?.topics)
        ? event.topics.map((topic: unknown) => this.deserializeScVal(topic))
        : event?.topics,
      value: this.deserializeScVal(event?.value),
    }
  }

  private static load(): DeadLetterEvent[] {
    try {
      if (!fs.existsSync(DLQ_FILE)) {
        const dir = path.dirname(DLQ_FILE)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(DLQ_FILE, JSON.stringify([]))
        return []
      }
      const data = fs.readFileSync(DLQ_FILE, 'utf-8')
      return JSON.parse(data || '[]')
    } catch (error) {
      logger.error(
        '[DLQ] Failed to load DLQ from file:',
        error instanceof Error ? error.message : 'Unknown error'
      )
      return []
    }
  }

  private static save(queue: DeadLetterEvent[]): void {
    try {
      const dir = path.dirname(DLQ_FILE)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(DLQ_FILE, JSON.stringify(queue, null, 2))
    } catch (error) {
      logger.error(
        '[DLQ] Failed to save DLQ to file:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  static async add(event: any, errorMsg: string): Promise<DeadLetterEvent> {
    const queue = this.load()
    const newEvent: DeadLetterEvent = {
      id:
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15),
      contractId: event.contractId || 'unknown',
      txHash: event.txHash || 'unknown',
      eventType: event.type || 'unknown',
      ledger: event.ledger || 0,
      error: errorMsg,
      payload: this.serializePayload(event),
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    queue.push(newEvent)
    this.save(queue)
    logger.warn(
      `[DLQ] Event added to DLQ. Size: ${queue.length}. Tx: ${newEvent.txHash}`
    )
    this.checkSizeAlert(queue.length)
    return newEvent
  }

  static getAll(): DeadLetterEvent[] {
    return this.load()
  }

  static getSize(): number {
    return this.load().length
  }

  static async retryAll(
    retryFn: (event: any) => Promise<void>
  ): Promise<{ resolved: number; failed: number }> {
    const queue = this.load()
    let resolvedCount = 0
    let failedCount = 0

    for (let i = 0; i < queue.length; i++) {
      const dlEvent = queue[i]
      if (dlEvent.status === 'PENDING' || dlEvent.status === 'RETRIED') {
        try {
          dlEvent.retryCount++
          dlEvent.updatedAt = new Date().toISOString()
          await retryFn(this.deserializePayload(dlEvent.payload))
          dlEvent.status = 'RESOLVED'
          resolvedCount++
          logger.info(`[DLQ Retry] Successfully retried event ${dlEvent.id}`)
        } catch (error) {
          dlEvent.status = 'RETRIED'
          failedCount++
          logger.error(
            `[DLQ Retry] Failed to retry event ${dlEvent.id}:`,
            error instanceof Error ? error.message : 'Unknown error'
          )
        }
      }
    }

    this.save(queue)
    logger.info(
      `[DLQ Retry] Finished. Resolved: ${resolvedCount}, Failed: ${failedCount}`
    )
    return { resolved: resolvedCount, failed: failedCount }
  }

  static async resolve(id: string): Promise<boolean> {
    const queue = this.load()
    const index = queue.findIndex((e) => e.id === id)
    if (index !== -1) {
      queue[index].status = 'RESOLVED'
      queue[index].updatedAt = new Date().toISOString()
      this.save(queue)
      return true
    }
    return false
  }

  private static checkSizeAlert(size: number): void {
    const THRESHOLD = 50 // Example threshold for alert
    if (size >= THRESHOLD) {
      logger.error(
        `[DLQ ALERT] Dead-letter queue size is critically high: ${size} events. Manual intervention required.`
      )
    }
  }
}
