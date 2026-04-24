const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || 'laas-dev-secret-change-me';
const TOKEN_TTL = '8h';
const MAX_CPU = 16;
const MAX_RAM = 64;

const sessionMap = new Map();

// 1. Setup gRPC Client
const packageDefinition = protoLoader.loadSync('./../lab.proto', {
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true
});
const labProto = grpc.loadPackageDefinition(packageDefinition).lab;
const grpcClient = new labProto.LabService('localhost:50051', grpc.credentials.createInsecure());

// Helper untuk membuat Metadata Auth
const getMeta = (studentId) => {
    const meta = new grpc.Metadata();
    meta.add('authorization', `Bearer ${studentId}`);
    return meta;
};

const envDefinitions = {
    DataScience_Python: { cpu: 2, ram: 4 },
    Database_MySQL: { cpu: 1, ram: 2 },
    WebServer_NodeJS: { cpu: 1, ram: 1 },
    Network_Lab: { cpu: 2, ram: 2 },
    FullStack_Dev: { cpu: 4, ram: 8 },
    ML_Training: { cpu: 4, ram: 16 },
};

const jobAllocations = new Map();
let reportMetricStream = null;

const getJobConfig = (job) => envDefinitions[job.envType] || { cpu: 1, ram: 1 };

const getPurposeWeight = (purpose) => {
    if (purpose === 'tugas_akhir') return 1.18;
    if (purpose === 'praktikum') return 1.0;
    return 0.86;
};

const getJobAllocation = (job) => {
    if (jobAllocations.has(job.jobId)) {
        return jobAllocations.get(job.jobId);
    }
    const fallback = getJobConfig(job);
    jobAllocations.set(job.jobId, fallback);
    return fallback;
};

const ensureReportMetricsStream = () => {
    if (reportMetricStream) return reportMetricStream;

    reportMetricStream = grpcClient.ReportMetrics((err) => {
        if (err) {
            console.error('[RPC] ReportMetrics stream closed with error:', err.message);
        }
        reportMetricStream = null;
    });

    reportMetricStream.on('error', (err) => {
        console.error('[RPC] ReportMetrics write error:', err.message);
        reportMetricStream = null;
    });

    return reportMetricStream;
};

const sendMetricsToRpc = (metrics) => {
    try {
        const stream = ensureReportMetricsStream();
        metrics.forEach((metric) => {
            stream.write({
                // Di sini setiap job diperlakukan sebagai agent env tersendiri.
                serverId: metric.serverId,
                cpuUsage: metric.cpuUsage,
                ramUsage: metric.ramUsage,
            });
        });
    } catch (err) {
        reportMetricStream = null;
        console.error('[RPC] gagal mengirim metrics:', err.message);
    }
};

const buildPrivateMetric = (job, clusterCpuUsage, clusterRamUsage, totalRunningCpu, totalRunningRam) => {
    const allocation = getJobAllocation(job);
    const purposeWeight = getPurposeWeight(job.purpose);
    const cpuPressure = totalRunningCpu > 0 ? (Number(allocation.cpu) / totalRunningCpu) * 100 : 0;
    const ramPressure = totalRunningRam > 0 ? (Number(allocation.ram) / totalRunningRam) * 100 : 0;

    // Per-agent metric: dipengaruhi load cluster + porsi alokasi agent + prioritas job.
    const cpuUsage = Math.min(99, Number((clusterCpuUsage * purposeWeight * 0.72 + cpuPressure * 0.28).toFixed(2)));
    const ramUsage = Math.min(99, Number((clusterRamUsage * purposeWeight * 0.72 + ramPressure * 0.28).toFixed(2)));

    return {
        jobId: job.jobId,
        serverId: `${job.studentId}:${job.jobId}`,
        cpuUsage,
        ramUsage,
        allocatedCpu: allocation.cpu,
        allocatedRam: allocation.ram,
        clusterCpuUsage,
        clusterRamUsage,
        source: 'rpc-derived',
        timestamp: Date.now(),
    };
};

const ensureSession = (studentId) => {
    if (!sessionMap.has(studentId)) {
        sessionMap.set(studentId, new Set());
    }
    return sessionMap.get(studentId);
};

app.get('/health', (_, res) => {
    res.json({ ok: true, service: 'gateway-ws' });
});

app.post('/auth/login', (req, res) => {
    const studentId = String(req.body?.studentId || '').trim();
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(studentId)) {
        return res.status(400).json({ message: 'Format Student ID tidak valid.' });
    }

    const token = jwt.sign({ studentId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    return res.json({
        token,
        studentId,
        expiresIn: TOKEN_TTL,
    });
});

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error('Token JWT wajib dikirim saat handshake.'));
        }

        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload?.studentId) {
            return next(new Error('Token JWT tidak memuat Student ID.'));
        }

        socket.studentId = payload.studentId;
        return next();
    } catch (err) {
        return next(new Error('Token JWT invalid atau expired.'));
    }
});

// --- LOGIKA DETEKTIF EXPIRED ---
let knownJobs = {}; // Menyimpan memori job yang sedang aktif
const manualTerminates = new Set(); // Mengingat job yang sengaja dimatikan user

// 2. Broadcast & Detektif setiap 2 detik
setInterval(() => {
    grpcClient.GetLabStatus({}, (err, response) => {
        if (err) {
            io.emit('server_alert', {
                type: 'error',
                message: 'Gateway gagal membaca status gRPC. Coba lagi beberapa saat.',
            });
            return;
        }

        const currentJobs = response.activeJobs || [];
        const currentJobIds = new Set(currentJobs.map(j => j.jobId));

        // Cek apakah ada job di ingatan kita yang tiba-tiba hilang dari server
        Object.keys(knownJobs).forEach(jobId => {
            if (!currentJobIds.has(jobId)) {
                const studentId = knownJobs[jobId].studentId;
                
                // Jika hilangnya KARENA user mencet tombol terminate, hapus dari catatan manual
                if (manualTerminates.has(jobId)) {
                    manualTerminates.delete(jobId);
                } else {
                    // Jika hilang TAPI BUKAN karena dipencet user, berarti KEDALUWARSA!
                    io.to(studentId).emit('server_alert', { 
                        type: 'info', 
                        message: `Environment ${jobId} telah kedaluwarsa dan otomatis dibersihkan server.` 
                    });
                }

                jobAllocations.delete(jobId);
            }
        });

        // Notifikasi transisi antre -> running untuk pemilik job
        currentJobs.forEach((job) => {
            const prev = knownJobs[job.jobId];
            if (prev && prev.status !== 'Running' && job.status === 'Running') {
                io.to(job.studentId).emit('server_alert', {
                    type: 'success',
                    message: `Environment ${job.jobId} sekarang Running dan siap dipakai.`,
                });
            }
        });

        // Update ingatan dengan data terbaru
        knownJobs = {};
        currentJobs.forEach(j => knownJobs[j.jobId] = j);

        const usedCpu = Math.max(0, MAX_CPU - Number(response.availableCpu || 0));
        const usedRam = Math.max(0, MAX_RAM - Number(response.availableRam || 0));
        const clusterCpuUsage = Number(((usedCpu / MAX_CPU) * 100).toFixed(2));
        const clusterRamUsage = Number(((usedRam / MAX_RAM) * 100).toFixed(2));

        const runningJobs = currentJobs.filter((job) => job.status === 'Running');
        const totalRunningCpu = runningJobs.reduce((acc, job) => acc + Number(getJobAllocation(job).cpu || 0), 0);
        const totalRunningRam = runningJobs.reduce((acc, job) => acc + Number(getJobAllocation(job).ram || 0), 0);

        const perAgentMetrics = runningJobs.map((job) =>
            buildPrivateMetric(job, clusterCpuUsage, clusterRamUsage, totalRunningCpu, totalRunningRam)
        );

        // Mengirim metrik per-agent env ke RPC ReportMetrics.
        sendMetricsToRpc(perAgentMetrics);

        // Broadcast status publik ke semua client (aman untuk ditampilkan global)
        io.emit('public_lab_status', {
            availableCpu: response.availableCpu,
            availableRam: response.availableRam,
            activeJobs: currentJobs.map((job) => ({
                jobId: job.jobId,
                studentId: job.studentId,
                envType: job.envType,
                purpose: job.purpose,
                status: job.status,
                startTime: job.startTime,
            })),
        });

        // Push data privat per sesi mahasiswa
        const jobsByStudent = new Map();
        currentJobs.forEach((job) => {
            if (!jobsByStudent.has(job.studentId)) {
                jobsByStudent.set(job.studentId, []);
            }
            jobsByStudent.get(job.studentId).push(job);
        });

        for (const [studentId, sockets] of sessionMap.entries()) {
            if (!sockets.size) continue;
            const ownedJobs = jobsByStudent.get(studentId) || [];
            const metrics = ownedJobs
                .filter((job) => job.status === 'Running')
                .map((job) => {
                    const existing = perAgentMetrics.find((item) => item.jobId === job.jobId);
                    return existing || buildPrivateMetric(job, clusterCpuUsage, clusterRamUsage, totalRunningCpu, totalRunningRam);
                });

            io.to(studentId).emit('private_lab_state', {
                studentId,
                ownedJobs,
                metrics,
                generatedAt: Date.now(),
            });
        }
    });
}, 2000);

// 3. WebSocket Connection Handler
io.on('connection', (socket) => {
    const studentId = socket.studentId;
    if (!studentId) return socket.disconnect(true);

    console.log(`🔌 [WS CONNECTED] ${studentId}`);
    socket.join(studentId); // Masuk ke room khusus untuk targeted event
    ensureSession(studentId).add(socket.id);
    io.to(studentId).emit('session_ready', { studentId, connectedAt: Date.now() });

    // A. Request Environment
    socket.on('request_env', (data) => {
        const payload = {
            envType: data?.envType,
            purpose: data?.purpose,
        };

        grpcClient.RequestEnvironment(payload, getMeta(studentId), (err, res) => {
            if (err) return io.to(studentId).emit('server_alert', { type: 'error', message: err.details });

            const requestedConfig = envDefinitions[payload.envType] || { cpu: 1, ram: 1 };
            jobAllocations.set(res.jobId, requestedConfig);
            
            io.to(studentId).emit('server_alert', { type: 'success', message: res.message });
            
            const stream = grpcClient.MonitorProvisioning({ jobId: res.jobId }, getMeta(studentId));
            stream.on('data', (logUpdate) => {
                io.to(studentId).emit('private_provision_log', { jobId: res.jobId, ...logUpdate });
            });
            stream.on('error', () => console.log(`Stream selesai/error untuk ${res.jobId}`));
        });
    });

    // B. Terminate Environment
    socket.on('terminate_env', (jobId) => {
        if (!jobId) return;
        manualTerminates.add(jobId); // Tandai bahwa ini di-terminate manual
        
        grpcClient.TerminateEnvironment({ jobId: jobId }, getMeta(studentId), (err, res) => {
            if (err) return io.to(studentId).emit('server_alert', { type: 'error', message: err.details });
            io.to(studentId).emit('server_alert', { type: 'success', message: res.message });
        });
    });

    // C. Scale Environment (Backend standby)
    socket.on('scale_env', (data) => {
        const payload = {
            jobId: data?.jobId,
            newCpu: Number(data?.newCpu),
            newRam: Number(data?.newRam),
        };

        if (!payload.jobId || Number.isNaN(payload.newCpu) || Number.isNaN(payload.newRam)) {
            return io.to(studentId).emit('server_alert', {
                type: 'error',
                message: 'Payload scaling tidak valid.',
            });
        }

        grpcClient.ScaleEnvironment(payload, getMeta(studentId), (err, res) => {
            if (err) return io.to(studentId).emit('server_alert', { type: 'error', message: err.details });

            jobAllocations.set(payload.jobId, {
                cpu: payload.newCpu,
                ram: payload.newRam,
            });
            io.to(studentId).emit('server_alert', { type: 'success', message: res.message });
        });
    });

    socket.on('disconnect', () => {
        const sessions = sessionMap.get(studentId);
        if (sessions) {
            sessions.delete(socket.id);
            if (sessions.size === 0) {
                sessionMap.delete(studentId);
            }
        }
        console.log(`❌ [WS DISCONNECTED] ${studentId}`);
    });
});

server.listen(4000, () => console.log('🚀 API Gateway WS berjalan di port 4000'));