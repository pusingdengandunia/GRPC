import { NextResponse } from 'next/server';
import { grpcClient } from '@/lib/grpc';

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Promise((resolve) => {
    // Timeout 1 detik untuk cek koneksi
    const deadline = new Date();
    deadline.setMilliseconds(deadline.getMilliseconds() + 500);
    
    grpcClient.waitForReady(deadline, (error: any) => {
      if (error) {
        resolve(NextResponse.json({ status: 'offline', message: error.message }));
      } else {
        resolve(NextResponse.json({ status: 'online' }));
      }
    });
  });
}
