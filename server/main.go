package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net"
	"sync"
	"time"

	"grpc-lab/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var ctx = context.Background()

type EnvConfig struct {
	CPU  float32
	RAM  float32
	Apps string
}

var envDefinitions = map[string]EnvConfig{
	"DataScience_Python": {CPU: 2, RAM: 4, Apps: "Jupyter, Pandas, Scikit-Learn"},
	"Database_MySQL": {CPU: 1, RAM: 2, Apps: "MySQL, phpMyAdmin"},
	"WebServer_NodeJS": {CPU: 1, RAM: 1, Apps: "Node.js, npm, Nginx"},
	"Network_Lab": {CPU: 2, RAM: 2, Apps: "Wireshark, GNS3"},
	"FullStack_Dev": {CPU: 4, RAM: 8, Apps: "Docker, Nginx"},
	"ML_Training": {CPU: 4, RAM: 16, Apps: "TensorFlow, PyTorch, CUDA"},
}

// Simulasi kuota (total resource pada server rack kampus)
const MAX_CPU = 16.0
const MAX_RAM = 64.0

type JobData struct {
	ID        string
	StudentId string
	Purpose   string
	Env       string
	Config    EnvConfig
	Status    string
	CreatedAt time.Time
}

type labServer struct {
	pb.UnimplementedLabServiceServer
	availableCpu float32
	availableRam float32
	mu           sync.Mutex
	jobs         map[string]*JobData
	queue        []*JobData
}

func getPriorityWeight(purpose string) int {
	switch purpose {
	case "tugas_akhir":
		return 3
	case "praktikum":
		return 2
	default:
		return 1
	}
}

// Background Worker Scheduler (Otak Penjadwalan)
func (s *labServer) processQueue() {
	for {
		time.Sleep(3 * time.Second)
		s.mu.Lock()
		if len(s.queue) > 0 {
			// Bersihkan job dari antrean jika sudah dihapus paksa
			validQueue := []*JobData{}
			for _, qJob := range s.queue {
				if _, exists := s.jobs[qJob.ID]; exists {
					validQueue = append(validQueue, qJob)
				}
			}
			s.queue = validQueue

			if len(s.queue) == 0 {
				s.mu.Unlock()
				continue
			}

			// Sort berdasarkan prioritas (tertinggi pertama), kalau sama by CreateAt (FIFO)
			for i := 0; i < len(s.queue)-1; i++ {
				for j := i + 1; j < len(s.queue); j++ {
					wI := getPriorityWeight(s.queue[i].Purpose)
					wJ := getPriorityWeight(s.queue[j].Purpose)
					if wJ > wI || (wI == wJ && s.queue[j].CreatedAt.Before(s.queue[i].CreatedAt)) {
						s.queue[i], s.queue[j] = s.queue[j], s.queue[i]
					}
				}
			}

			// Coba alokasikan job top-priority jika muat
			topJob := s.queue[0]
			if s.availableCpu >= topJob.Config.CPU && s.availableRam >= topJob.Config.RAM {
				log.Printf("[SCHEDULER] Job %s (Prioritas: %s) dialokasikan terlebih dahulu!", topJob.ID, topJob.Purpose)
				s.availableCpu -= topJob.Config.CPU
				s.availableRam -= topJob.Config.RAM
				topJob.Status = "Running"
				s.queue = s.queue[1:] // pop queue
			}
		}
		s.mu.Unlock()
	}
}

func (s *labServer) RequestEnvironment(ctx context.Context, req *pb.EnvRequest) (*pb.EnvResponse, error) {
	config, ok := envDefinitions[req.EnvType]
	if !ok {
		return nil, status.Errorf(codes.InvalidArgument, "Konfigurasi environment '%s' tidak ditemukan.", req.EnvType)
	}

	// Otak Sistem: Cek batas keras mutlak (apakah env-nya minta lebih besar dari kapasitas maksimal server fisik?)
	if config.CPU > MAX_CPU || config.RAM > MAX_RAM {
		return nil, status.Errorf(codes.InvalidArgument, "Resource ditolak mutlak! %s meminta %v CPU, melebihi batas hardware total.", req.EnvType, config.CPU)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Jika concurrent env melebihi 50 atau antrean lebih dari 5, tolak ResourceExhausted
	if len(s.jobs) >= 50 {
		return nil, status.Errorf(codes.ResourceExhausted, "Resource Exhausted: Kuota server lab penuh!")
	}
	if len(s.queue) >= 5 {
		return nil, status.Errorf(codes.ResourceExhausted, "Resource Exhausted: Server terlalu sibuk!")
	}
	
	var finalStatus string
	if s.availableCpu < config.CPU || s.availableRam < config.RAM {
		// Antre-kan
		finalStatus = "Queued"
	} else {
		// Langsung running
		finalStatus = "Running"
		s.availableCpu -= config.CPU
		s.availableRam -= config.RAM
	}

	jobID := fmt.Sprintf("JOB-%d", rand.Intn(10000))
	log.Printf("[REQ IN] %s | Env: %s | CPU: %.1f | RAM: %.1f | Purpose: %s | Action: %s", req.StudentId, req.EnvType, config.CPU, config.RAM, req.Purpose, finalStatus)

	jobData := &JobData{
		ID:        jobID,
		StudentId: req.StudentId,
		Purpose:   req.Purpose,
		Env:       req.EnvType,
		Config:    config,
		Status:    finalStatus,
		CreatedAt: time.Now(),
	}
	s.jobs[jobID] = jobData
	if finalStatus == "Queued" {
		s.queue = append(s.queue, jobData)
	}

	go func(id string, c EnvConfig) {
		time.Sleep(120 * time.Second)
		s.mu.Lock()
		defer s.mu.Unlock()
		if job, ok := s.jobs[id]; ok && job.Status == "Running" {
			s.availableCpu += c.CPU
			s.availableRam += c.RAM
			delete(s.jobs, id)
			log.Printf("[CLEANUP-TIMERS] Environment %s kedaluwarsa setelah 2 menit. Dihapus.", id)
		} else if ok {
			delete(s.jobs, id)
		}
	}(jobID, config)

	message := fmt.Sprintf("Dijadwalkan! %s. Status: %s. Tujuan: %s", req.EnvType, finalStatus, req.Purpose)
	return &pb.EnvResponse{
		JobId:   jobID,
		Message: message,
	}, nil
}

func (s *labServer) MonitorProvisioning(req *pb.ProvisionJob, stream pb.LabService_MonitorProvisioningServer) error {
	s.mu.Lock()
	jobData, ok := s.jobs[req.JobId]
	s.mu.Unlock()

	if !ok {
		return status.Errorf(codes.NotFound, "Job ID %s tidak ditemukan.", req.JobId)
	}

	queueLogSent := false
	// Deadline exceeded monitoring check
	deadline := jobData.CreatedAt.Add(30 * time.Second)

	// Menunggu scheduler mengalokasikan (Jika status Queued)
	for {
		s.mu.Lock()
		jobData, ok = s.jobs[req.JobId]
		s.mu.Unlock()

		if !ok {
			return status.Errorf(codes.NotFound, "EnvID tidak ada atau sudah kadaluarsa (Dihapus saat mengantre).")
		}
		if jobData.Status == "Running" {
			break
		}

		if time.Now().After(deadline) {			
			s.mu.Lock()
			delete(s.jobs, req.JobId)
			s.mu.Unlock()
			log.Printf("[TIMEOUT] Job ID %s provisioning timeout > 5 menit", req.JobId)
			return status.Errorf(codes.DeadlineExceeded, "Provisioning timeout > 5 menit")
		}

		if !queueLogSent {
			stream.Send(&pb.LogUpdate{Progress: 0, Status: fmt.Sprintf("[%s] Job sedang mengantre di Resource Scheduler (Prioritas: %s) ...", jobData.ID, jobData.Purpose)})
			queueLogSent = true
		}
		time.Sleep(2 * time.Second)
	}

	appStr := jobData.Config.Apps

	steps := []string{
		fmt.Sprintf("Mengecek image (%s) & Container...", jobData.Env),
		fmt.Sprintf("Menyetel Jaringan / Network Bridge untuk Container..."),
		fmt.Sprintf("Mengalokasikan Resource Hardware (%.1f CPU, %.1f GB RAM)...", jobData.Config.CPU, jobData.Config.RAM),
		fmt.Sprintf("Mengonfigurasi Aplikasi Bawaan: %s...", appStr),
		fmt.Sprintf("Verifikasi %s port connectivity dan memunculkan Endpoint...", jobData.Env),
		"Lingkungan lab siap digunakan!",
	}

	for i, step := range steps {
		progress := int32(float32(i+1) / float32(len(steps)) * 100)
		if err := stream.Send(&pb.LogUpdate{
			Progress: progress,
			Status:   step,
		}); err != nil {
			return err
		}
		time.Sleep(1500 * time.Millisecond) // Simulasi Agent Provisioning Delay
	}

	return nil
}

func (s *labServer) TerminateEnvironment(ctx context.Context, req *pb.TerminateRequest) (*pb.TerminateResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[req.JobId]
	if !ok {
		return nil, status.Errorf(codes.NotFound, "EnvID tidak ada atau sudah kadaluarsa")
	}

	// Kembalikan resource jika job tersebut sudah berlari memakan resource aktif
	if job.Status == "Running" {
		s.availableCpu += job.Config.CPU
		s.availableRam += job.Config.RAM
	}
	
	// Hapus dari mapping langsung
	delete(s.jobs, req.JobId)
	log.Printf("[TERMINATE] Job %s dihapus paksa. Resource dikembalikan. CPU: %.2f | RAM: %.2f", req.JobId, s.availableCpu, s.availableRam)

	return &pb.TerminateResponse{
		Message: fmt.Sprintf("[%s] Environment berhasil dimatikan dan resource dikembalikan", req.JobId),
	}, nil
}

func (s *labServer) ReportMetrics(stream pb.LabService_ReportMetricsServer) error {
	for {
		metric, err := stream.Recv()
		if err != nil {
			return stream.SendAndClose(&pb.MetricAck{Message: "Stream ditutup"})
		}		
		log.Printf("[METRIC] Server Agent %s : CPU %.2f%% | RAM %.2f%%", metric.ServerId, metric.CpuUsage, metric.RamUsage)
	}
}

func (s *labServer) GetLabStatus(ctx context.Context, req *pb.Empty) (*pb.LabStatusResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var jobs []*pb.ActiveJob
	for _, job := range s.jobs {
		jobs = append(jobs, &pb.ActiveJob{
			JobId:     job.ID,
			StudentId: job.StudentId,
			EnvType:   job.Env,
			Purpose:   job.Purpose,
			Status:    job.Status,
			StartTime: job.CreatedAt.Format(time.RFC3339),
		})
	}

	return &pb.LabStatusResponse{
		AvailableCpu: s.availableCpu,
		AvailableRam: s.availableRam,
		ActiveJobs:   jobs,
	}, nil
}

func main() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatal(err)
	}

	s := grpc.NewServer()

	labSrv := &labServer{
		availableCpu: MAX_CPU,
		availableRam: MAX_RAM,
		jobs:         make(map[string]*JobData),
		queue:        make([]*JobData, 0),
	}

	go labSrv.processQueue()
	
	pb.RegisterLabServiceServer(s, labSrv)

	log.Println("Campus Lab-as-a-Service berjalan di port :50051")
	if err := s.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
