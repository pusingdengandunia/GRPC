import { NextRequest } from 'next/server';
import { grpcClient } from '@/lib/grpc';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const job_id = searchParams.get('job_id');

  if (!job_id) {
    return new Response('Missing job_id parameter', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Connect to the gRPC server-side stream
      const call = grpcClient.MonitorProvisioning({ job_id });

      call.on('data', (data: any) => {
        // Encode and send chunk using SSE format: "data: {json}\n\n"
        const msg = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
      });

      call.on('end', () => {
        // Send a custom event "end" when stream is done (optional, client parsing needs it or we close)
        const msg = `event: end\ndata: {}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
        controller.close();
      });

      call.on('error', (err: any) => {
        console.error('SSE gRPC Error:', err);
        const msg = `event: error\ndata: ${err.message}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));
        controller.close();
      });
      
      req.signal.addEventListener('abort', () => {
         // Client closed mapping to Go
         call.cancel();
      })
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
