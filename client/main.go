package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"grpc-lab/pb" // Sesuaikan dengan module path kamu

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// Helper untuk membuat context yang membawa "JWT Token" simulasi
func getAuthContext(studentID string) context.Context {
	md := metadata.Pairs("authorization", "Bearer "+studentID)
	return metadata.NewOutgoingContext(context.Background(), md)
}

func main() {
	conn, err := grpc.Dial("localhost:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("Gagal terhubung: %v", err)
	}
	defer conn.Close()
	
	client := pb.NewLabServiceClient(conn)
	reader := bufio.NewReader(os.Stdin)

	// SIMULASI LOGIN SESI
	fmt.Println("=== 🔐 Login Lab System ===")
	fmt.Print("Masukkan Student ID Anda (Misal: MHS-001): ")
	loggedInUser, _ := reader.ReadString('\n')
	loggedInUser = strings.TrimSpace(loggedInUser)
	fmt.Printf("✅ Login berhasil sebagai: %s\n", loggedInUser)

	for {
		fmt.Printf("\n=== 🛠️ CLI Lab-as-a-Service (%s) ===\n", loggedInUser)
		fmt.Println("1. Request Environment Baru")
		fmt.Println("2. Cek Status Lab (Publik)")
		fmt.Println("3. Terminate Environment (Privat)")
		fmt.Println("4. Scale Environment (Privat)")
		fmt.Println("0. Keluar")
		fmt.Print("Pilih menu: ")

		var choice int
		fmt.Scanln(&choice)

		// Context yang selalu membawa identitas user yang sedang login
		ctx := getAuthContext(loggedInUser)

		switch choice {
		case 1:
			fmt.Println("\nPilihan Env: DataScience_Python, Database_MySQL, WebServer_NodeJS, Network_Lab, FullStack_Dev, ML_Training")
			fmt.Print("Masukkan Env Type: ")
			envType, _ := reader.ReadString('\n')
			
			fmt.Println("Pilihan Tujuan: tugas_akhir, praktikum, umum")
			fmt.Print("Masukkan Tujuan (Purpose): ")
			purpose, _ := reader.ReadString('\n')

			// StudentId sudah TIDAK ADA di payload, server mengambilnya dari ctx (Metadata)
			req := &pb.EnvRequest{
				EnvType:   strings.TrimSpace(envType),
				Purpose:   strings.TrimSpace(purpose),
			}
			res, err := client.RequestEnvironment(ctx, req)
			if err != nil {
				fmt.Printf("❌ Error: %v\n", err)
			} else {
				fmt.Printf("✅ %s (Job ID: %s)\n", res.Message, res.JobId)
			}

		case 2:
			// Status lab bersifat publik, tapi pakai ctx auth juga tidak apa-apa
			res, err := client.GetLabStatus(ctx, &pb.Empty{})
			if err != nil {
				fmt.Printf("❌ Error: %v\n", err)
				continue
			}
			fmt.Printf("\n📊 Sisa Resource Server -> CPU: %.1f, RAM: %.1f GB\n", res.AvailableCpu, res.AvailableRam)
			if len(res.ActiveJobs) == 0 {
				fmt.Println("   (Tidak ada job yang aktif)")
			} else {
				for _, job := range res.ActiveJobs {
					// Beri tanda [MILIK ANDA] jika job tersebut milik user yang sedang login
					ownership := ""
					if job.StudentId == loggedInUser {
						ownership = "⭐ [MILIK ANDA]"
					}
					fmt.Printf("   - [%s] %s (%s) | Status: %s %s\n", job.JobId, job.EnvType, job.StudentId, job.Status, ownership)
				}
			}

		case 3:
			fmt.Print("\nMasukkan Job ID yang ingin di-terminate: ")
			jobID, _ := reader.ReadString('\n')
			
			res, err := client.TerminateEnvironment(ctx, &pb.TerminateRequest{JobId: strings.TrimSpace(jobID)})
			if err != nil {
				fmt.Printf("❌ Gagal Terminate: %v\n", err)
			} else {
				fmt.Printf("✅ %s\n", res.Message)
			}

		case 4:
			fmt.Print("\nMasukkan Job ID yang ingin di-scale: ")
			jobID, _ := reader.ReadString('\n')
			
			fmt.Print("Masukkan alokasi CPU Baru (Misal: 4.5): ")
			cpuStr, _ := reader.ReadString('\n')
			newCpu, _ := strconv.ParseFloat(strings.TrimSpace(cpuStr), 32)

			fmt.Print("Masukkan alokasi RAM Baru (Misal: 8): ")
			ramStr, _ := reader.ReadString('\n')
			newRam, _ := strconv.ParseFloat(strings.TrimSpace(ramStr), 32)

			req := &pb.ScaleRequest{
				JobId:  strings.TrimSpace(jobID),
				NewCpu: float32(newCpu),
				NewRam: float32(newRam),
			}

			res, err := client.ScaleEnvironment(ctx, req)
			if err != nil {
				fmt.Printf("❌ Gagal Scaling: %v\n", err)
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