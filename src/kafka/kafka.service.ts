import { Injectable, Logger } from '@nestjs/common';
import {
  Kafka,
  EachMessagePayload,
  CompressionTypes,
  Consumer,
  Producer,
  logLevel,
} from 'kafkajs';
import { stringifyError } from '../utils/error';
import { ConnectionMode } from '../contants/mode';
import { KafkaConfiguration } from '../types/kafka-configuration';

@Injectable()
export class KafkaService {
  private static client: Kafka;
  private consumer: Consumer;
  private producer: Producer;
  private readonly configuration: KafkaConfiguration;

  private readonly logger: Logger = new Logger(KafkaService.name);

  constructor(kafkaConfiguration: KafkaConfiguration) {
    this.configuration = kafkaConfiguration;
  }

  protected createKafkaLogger(topLevel) {
    const logger: Logger = new Logger(KafkaService.name);
    const toPinoLogLevel = (level: number) => {
      let localLevel = null;
      switch (level) {
        case logLevel.ERROR:
        case logLevel.NOTHING:
          localLevel = 'error';
          break;
        case logLevel.WARN:
          localLevel = 'warn';
          break;
        case logLevel.INFO:
          localLevel = 'log';
          break;
        case logLevel.DEBUG:
          localLevel = 'debug';
          break;
        default:
          localLevel = 'log';
      }

      return localLevel;
    };
    return ({ level, log, namespace, label }) => {
      logger[toPinoLogLevel(level)]({
        identifier: 'kafka-internal-logs',
        ...log,
        namespace,
        topLevel,
        label,
      });
    };
  }

  async connect(mode: ConnectionMode) {
    this.logger.log(
      `info.KafkaService.connect.${JSON.stringify(this.configuration)}`,
    );
    if (!KafkaService.client) {
      KafkaService.client = new Kafka({
        brokers: this.configuration.brokers,
        clientId: this.configuration.clientId,
        ssl: this.configuration.ssl,
        connectionTimeout: this.configuration.timeout,
        retry: {
          restartOnFailure: async (e: Error) => {
            this.logger.error(
              `error.KafkaService.connect.retry.${stringifyError(e)}`,
            );
            return true;
          },
          retries: this.configuration.retries,
        },
        logCreator: this.createKafkaLogger,
      });
    }

    if ([ConnectionMode.Both, ConnectionMode.Consumer].includes(mode)) {
      this.consumer = KafkaService.client.consumer({
        heartbeatInterval: this.configuration.heartbeatInterval || 10000,
        sessionTimeout: this.configuration.sessionTimeout || 30000,
        groupId: this.configuration.groupId,
      });
      await this.consumer.connect();
    }

    if ([ConnectionMode.Both, ConnectionMode.Producer].includes(mode)) {
      this.producer = KafkaService.client.producer({
        allowAutoTopicCreation: true,
      });
      await this.producer.connect();
    }

    this.logger.log(
      `info.KafkaService.connected.${JSON.stringify(this.configuration)}`,
    );
  }

  async disconnect() {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }

  async send(options: {
    topic: string;
    messages: any[];
    key?: string;
  }): Promise<void> {
    this.logger.log(
      `info.KafkaService.send.messages.${options.messages.length}`,
    );
    for (const message of options.messages) {
      try {
        await this.producer.send({
          topic: options.topic,
          messages: [{ value: JSON.stringify(message), key: options.key }],
          compression: CompressionTypes.GZIP,
        });
      } catch (error) {
        this.logger.error(
          `error.KafkaService.send.error.${stringifyError(error)}`,
        );
      }
    }
  }

  async consume(topics: string[], onMessage: Function) {
    try {
      await this.consumer.subscribe({
        topics,
        fromBeginning: false,
      });
      await this.consumer.run({
        autoCommit: true,
        partitionsConsumedConcurrently: this.configuration.concurrentIngestion,
        eachMessage: async (messagePayload: EachMessagePayload) => {
          this.handleMessage(messagePayload, onMessage);
        },
      });
    } catch (error) {
      this.logger.error(
        `error.KafkaService.consume.error.${stringifyError(error)}`,
      );
      if (error.message.includes('coordinator not aware')) {
        process.exit(1);
      }
    }
  }

  /**
   * handleManagerEvent
   */
  private async handleMessage(
    payload: EachMessagePayload,
    wrappedFunction: Function,
  ): Promise<void> {
    const data = JSON.parse(payload.message.value.toString());
    this.logger.log(
      `info.KafkaService.consume.eachMessage.messagePayload.${payload.message.value.toString()}`,
    );
    try {
      await payload.heartbeat();
      wrappedFunction(data);
    } catch (e) {
      this.logger.error(
        `error.KafkaService.consume.eachMessage.error.${stringifyError(
          e,
        )}.payload.${payload}`,
      );
    }
  }
}
