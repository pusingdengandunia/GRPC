import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(process.cwd(), 'proto/lab.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const labProto = protoDescriptor.lab;

// Use the gRPC server URL (default 50051 running locally)
const API_URL = process.env.GRPC_SERVER_URL || 'localhost:50051';

// Create and export the gRPC Client singleton
export const grpcClient = new labProto.LabService(
  API_URL,
  grpc.credentials.createInsecure()
);
