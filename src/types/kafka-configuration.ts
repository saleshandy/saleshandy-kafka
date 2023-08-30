export type KafkaConfiguration = {
  ssl: boolean;
  timeout: number;
  brokers: Array<string>;
  clientId: string;
  groupId: string;
  concurrentIngestion: number;
  retries: number;
  heartbeatInterval?: number;
  sessionTimeout?: number;
};
