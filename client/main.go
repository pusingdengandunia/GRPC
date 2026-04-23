package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"grpc-lab/pb" // Sesuaikan path

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	conn, err := grpc.Dial("localhost:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("Gagal terhubung: %v", err)
	}
	defer conn.Close()
	client := pb.NewLabServiceClient(conn)
	reader := bufio.NewReader(os.Stdin)

	for {
		fmt.Println("\n=== 🛠️ Kampus Lab-as-a-Service CLI ===")
		fmt.Println("1. Request Environment Baru")
		fmt.Println("2. Cek Status Lab")
		fmt.Println("3. Terminate Environment")
		fmt.Println("0. Keluar")
		fmt.Print("Pilih menu: ")

		var choice int
		fmt.Scanln(&choice)

		switch choice {
		case 1:
			fmt.Print("Masukkan Student ID: ")
			studentID, _ := reader.ReadString('\n')
			
			fmt.Println("Pilihan Env: DataScience_Python, Database_MySQL, WebServer_NodeJS, Network_Lab, FullStack_Dev, ML_Training")
			fmt.Print("Masukkan Env Type: ")
			envType, _ := reader.ReadString('\n')
			
			fmt.Println("Pilihan Tujuan: tugas_akhir, praktikum, umum")
			fmt.Print("Masukkan Tujuan (Purpose): ")
			purpose, _ := reader.ReadString('\n')

			req := &pb.EnvRequest{
				StudentId: strings.TrimSpace(studentID),
				EnvType:   strings.TrimSpace(envType),
				Purpose:   strings.TrimSpace(purpose),
			}
			res, err := client.RequestEnvironment(context.Background(), req)
			if err != nil {
				fmt.Printf("❌ Error: %v\n", err)
			} else {
				fmt.Printf("✅ %s (Job ID: %s)\n", res.Message, res.JobId)
			}

		case 2:
			res, err := client.GetLabStatus(context.Background(), &pb.Empty{})
			if err != nil {
				fmt.Printf("❌ Error: %v\n", err)
				continue
			}
			fmt.Printf("📊 Sisa Resource -> CPU: %.1f, RAM: %.1f GB\n", res.AvailableCpu, res.AvailableRam)
			for _, job := range res.ActiveJobs {
				fmt.Printf("   - [%s] %s (%s) | Status: %s\n", job.JobId, job.EnvType, job.StudentId, job.Status)
			}

		case 3:
			fmt.Print("Masukkan Job ID yang ingin di-terminate: ")
			jobID, _ := reader.ReadString('\n')
			res, err := client.TerminateEnvironment(context.Background(), &pb.TerminateRequest{JobId: strings.TrimSpace(jobID)})
			if err != nil {
				fmt.Printf("❌ Error: %v\n", err)
			} else {
				fmt.Printf("✅ %s\n", res.Message)
			}

		case 0:
			fmt.Println("Keluar dari sistem.")
			return
		default:
			fmt.Println("Pilihan tidak valid.")
		}
	}
}