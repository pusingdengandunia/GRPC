import { NextResponse } from 'next/server';
import { grpcClient } from '@/lib/grpc';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const metrics = body.metrics; // Array of { server_id, cpu_usage, ram_usage }

    if (!Array.isArray(metrics)) {
      return NextResponse.json({ error: 'Missing metrics array' }, { status: 400 });
    }

    return new Promise((resolve, reject) => {
      // Start the client-stream call to Go Server
      const call = grpcClient.ReportMetrics((error: any, response: any) => {
        if (error) {
          console.error(error);
          resolve(NextResponse.json({ error: error.message }, { status: 500 }));
        } else {
          resolve(NextResponse.json(response));
        }
      });

      // Stream data from Next.js to Go
      const writeMetrix = async () => {
        for (const metric of metrics) {
          call.write(metric);
          // optional small delay to simulate network latency if we want, but synchronous loop is fine too
          await new Promise((res) => setTimeout(res, 500));
        }

        // Close the stream from client side
        call.end();
      }
      
      writeMetrix();
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
