import { NextResponse } from 'next/server';
import { grpcClient } from '@/lib/grpc';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return NextResponse.json(
        { error: 'Missing job_id' },
        { status: 400 }
      );
    }

    return new Promise((resolve) => {
      grpcClient.TerminateEnvironment(
        { job_id },
        (error: any, response: any) => {
          if (error) {
            resolve(
              NextResponse.json(
                { error: error.message },
                { status: 500 }
              )
            );
          } else {
            resolve(NextResponse.json(response));
          }
        }
      );
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
