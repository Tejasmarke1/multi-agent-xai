import axios from 'axios'
import type { JobStatus, FeedbackRow, CalibrateResult } from '../types'

const BASE = '/api'

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

export async function runPipeline(topic: string, maxResults = 30): Promise<{ job_id: string }> {
  const res = await api.post('/run', { topic, max_results: maxResults })
  return res.data
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await api.get(`/status/${jobId}`)
  return res.data
}

export async function submitFeedback(row: FeedbackRow): Promise<void> {
  await api.post('/feedback', row)
}

export async function calibrateWeights(): Promise<CalibrateResult> {
  const res = await api.post('/calibrate')
  return res.data
}

export async function getFeedbackCount(): Promise<{ count: number }> {
  const res = await api.get('/feedback/count')
  return res.data
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await api.get('/health')
  return res.data
}
