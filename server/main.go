package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net"
	"sync"
	"time"

	"grpc-lab/pb" // sesuaikan dengan path output proto anda

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var ctx = context.Background()

type labServer struct {
	pb.UnimplementedLabServiceServer
	// Simpan state sederhana di memori
	serverCapacity float32
	state          sync.Map
}

// 1. Unary: Request Environment
func (s *labServer) RequestEnvironment(ctx context.Context, req *pb.EnvRequest) (*pb.EnvResponse, error) {
	if s.serverCapacity > 90.0 {
		return nil, status.Errorf(codes.ResourceExhausted, "Kuota lab penuh! Kapasitas saat ini: %.2f%%", s.serverCapacity)
	}

	jobID := fmt.Sprintf("JOB-%d", rand.Intn(1000))
	assignedIP := fmt.Sprintf("10.0.0.%d", rand.Intn(250))
	log.Printf("Menerima request dari %s untuk %s", req.StudentId, req.EnvType)

	//simpan ke memori lokal
	s.state.Store(jobID, assignedIP)

	return &pb.EnvResponse{
		JobId:   jobID,
		Message: "Permintaan diterima, sedang mengantre.",
	}, nil
}

// 2. Server-side Streaming: Real-time Provisioning Logs
func (s *labServer) MonitorProvisioning(req *pb.ProvisionJob, stream pb.LabService_MonitorProvisioningServer) error {
	steps := []string{
		"Menarik Docker Image...",
		"Mengonfigurasi Network Bridge...",
		"Mengalokasikan IP Address...",
		"Lab siap digunakan!",
	}

	for i, step := range steps {
		progress := int32((i + 1) * 25)
		if err := stream.Send(&pb.LogUpdate{
			Progress: progress,
			Status:   step,
		}); err != nil {
			return err
		}
		time.Sleep(2 * time.Second) // Simulasi proses delay
	}
	return nil
}

// 3. Client-side Streaming: Monitoring dari Agent
func (s *labServer) ReportMetrics(stream pb.LabService_ReportMetricsServer) error {
	for {
		metric, err := stream.Recv()
		if err != nil {
			return stream.SendAndClose(&pb.MetricAck{Message: "Stream ditutup"})
		}
		// Update state kapasitas berdasarkan laporan agent
		s.serverCapacity = metric.CpuUsage
		log.Printf("[METRIC] Server %s melapor: CPU %.2f%%", metric.ServerId, metric.CpuUsage)
	}
}

func main() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatal(err)
	}

	s := grpc.NewServer()

	pb.RegisterLabServiceServer(s, &labServer{
		serverCapacity: 0,
	})

	log.Println("Campus Lab-as-a-Service berjalan di port :50051")
	if err := s.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
