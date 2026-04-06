package main

import (
	"context"
	"log"
	"math/rand"
	"time"

	"grpc-lab/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	conn, err := grpc.NewClient("localhost:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	//inisialisasi client
	client := pb.NewLabServiceClient(conn)

	// Simulasi pengiriman metrik secara kontinyu (Client-side Streaming)
	stream, err := client.ReportMetrics(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	//provisioning agent simulasi
	go func() {
		for {
			metric := &pb.ServerMetric{
				ServerId: "LAB-RUM-01",
				CpuUsage: rand.Float32() * 100,
				RamUsage: rand.Float32() * 100,
			}
			stream.Send(metric)
			time.Sleep(5 * time.Second)
		}
	}()

	// Simulasi alur mahasiswa
	// 1. Request
	res, err := client.RequestEnvironment(context.Background(), &pb.EnvRequest{
		StudentId: "NIM12345",
		EnvType:   "DataScience_Python",
	})
	if err != nil {
		log.Fatalf("Gagal melakukan request environment: %v", err)
	}
	log.Printf("Job Created: %s", res.JobId)

	// 2. Monitor Progress
	logStream, err := client.MonitorProvisioning(context.Background(), &pb.ProvisionJob{JobId: res.JobId})
	if err != nil {
		log.Fatalf("Gagal memonitor log provisioning: %v", err)
	}
	for {
		update, err := logStream.Recv()
		if err != nil {
			break
		}
		log.Printf("[%d%%] %s", update.Progress, update.Status)
	}
}
