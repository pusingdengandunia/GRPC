import { NextResponse } from 'next/server';
import { grpcClient } from '../../../../lib/grpc';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return new Promise((resolve) => {
    grpcClient.GetLabStatus({}, (err: any, response: any) => {
      if (err) {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json(response));
      }
    });
  });
}
