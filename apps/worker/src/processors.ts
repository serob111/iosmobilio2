export type PingJobData = { requestId?: string };
export type PingJobResult = { pong: true; requestId?: string };

export function processPingJob(data: PingJobData): PingJobResult {
  return { pong: true, requestId: data.requestId };
}
