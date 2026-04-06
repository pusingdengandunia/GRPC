import { NextResponse } from 'next/server';
import { grpcClient } from '@/lib/grpc';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { student_id, env_type } = body;

    if (!student_id || !env_type) {
      return NextResponse.json(
        { error: 'Missing student_id or env_type' },
        { status: 400 }
      );
    }

    return new Promise((resolve, reject) => {
      grpcClient.RequestEnvironment(
        { student_id, env_type },
        (error: any, response: any) => {
          if (error) {
            console.error('gRPC error:', error);
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
