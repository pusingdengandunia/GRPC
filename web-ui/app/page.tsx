'use client';

import { useState, useEffect } from 'react';

interface ActiveEnv {
  jobId: string;
  studentId: string;
  envType: string;
  purpose: string;
  status: string;
  startTime: string;
}

export default function Home() {
  const [studentId, setStudentId] = useState('');
  const [envType, setEnvType] = useState('');
  const [purpose, setPurpose] = useState('');
  const [jobId, setJobId] = useState('');
  const [unaryResponse, setUnaryResponse] = useState('');
  
  const [labState, setLabState] = useState<{availableCpu: number, availableRam: number, activeJobs: ActiveEnv[]}>({
    availableCpu: 16,
    availableRam: 64,
    activeJobs: []
  });

  
  const [logs, setLogs] = useState<string[]>([]);
  const [isProvisioning, setIsProvisioning] = useState(false);
  
  const [metricsResponse, setMetricsResponse] = useState('');
  const [isSendingMetrics, setIsSendingMetrics] = useState(false);
  const [sentMetrics, setSentMetrics] = useState<{server_id: string, cpu_usage: number, ram_usage: number}[]>([]);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const [sysRes, labRes] = await Promise.all([
          fetch('/api/status', { cache: 'no-store' }),
          fetch('/api/lab/status', { cache: 'no-store' })
        ]);
        
        const sysData = await sysRes.json();
        setServerStatus(sysData.status === 'online' ? 'online' : 'offline');

        if (labRes.ok) {
          const labData = await labRes.json();
          // transform protobuf response slightly (handle snake_case payload):
          setLabState({
            availableCpu: labData.availableCpu ?? labData.available_cpu ?? 0,
            availableRam: labData.availableRam ?? labData.available_ram ?? 0,
            activeJobs: (labData.activeJobs || labData.active_jobs || []).map((job: any) => ({
                jobId: job.jobId || job.job_id,
                studentId: job.studentId || job.student_id,
                envType: job.envType || job.env_type,
                purpose: job.purpose,
                status: job.status,
                startTime: job.startTime || job.start_time
            }))
          });
        }
      } catch (err) {
        setServerStatus('offline');
      }
    };
    
    // Check initially
    checkStatus();
    // Poll every 3 seconds
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const requestEnvironment = async () => {
    setUnaryResponse('Mengeksekusi RPC...');
    try {
      const res = await fetch('/api/env/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, env_type: envType, purpose: purpose }),
      });
      const data = await res.json();
      // Perhatikan: properti dari JSON menggunakan snake_case `job_id` sesuai definisi gRPC/Protobuf
      if (res.ok && data.job_id) {
        setJobId(data.job_id);
        setUnaryResponse(`Sukses: ${data.message} | JobID: ${data.job_id}`);
      } else {
        setUnaryResponse(`Error: ${data.error || JSON.stringify(data)}`);
      }
    } catch (err: any) {
      setUnaryResponse(`Koneksi Gagal: ${err.message}`);
    }
  };

  const monitorProvisioning = () => {
    if (!jobId) {
      alert('Harap selesaikan Request Environment terlebih dahulu untuk mendapatkan Job ID.');
      return;
    }
    
    setLogs([]);
    setIsProvisioning(true);
    const eventSource = new EventSource(`/api/env/monitor?job_id=${jobId}`);
    
    eventSource.onopen = () => {
      setLogs((prev) => [...prev, '> [SSE] Koneksi Berhasil Terbuka. Menunggu Server Stream...']);
    };
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs((prev) => [...prev, `[Progress: ${data.progress}%] - ${data.status}`]);
    };

    eventSource.addEventListener('end', () => {
      setLogs((prev) => [...prev, '> [SSE] Stream Selesai. Koneksi Ditutup.']);
      eventSource.close();
      setIsProvisioning(false);
    });

    eventSource.onerror = () => {
      setLogs((prev) => [...prev, '> [SSE] Error / Server memutus stream.']);
      eventSource.close();
      setIsProvisioning(false);
    };
  };

  const startSendingMetrics = async () => {
    setIsSendingMetrics(true);
    setMetricsResponse('');
    setSentMetrics([]);
    
    // Generate 5 stream data payloads
    const metricsPayload = Array.from({ length: 5 }).map((_, i) => ({
      server_id: `LAB-WEB-0${i+1}`,
      cpu_usage: Math.floor(Math.random() * 100),
      ram_usage: Math.floor(Math.random() * 100)
    }));

    // Simulasikan kemunculan data di UI satu per satu menyesuaikan delay backend (500ms)
    metricsPayload.forEach((metric, index) => {
      setTimeout(() => {
        setSentMetrics((prev) => [...prev, metric]);
      }, (index + 1) * 500);
    });
    
    try {
      const res = await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics: metricsPayload }),
      });
      const data = await res.json();
      if (res.ok) {
        setMetricsResponse(`[Akhir Stream] Ack Response Server: ${data.message || JSON.stringify(data)}`);
      } else {
        setMetricsResponse(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setMetricsResponse(`Koneksi Gagal: ${err.message}`);
    } finally {
      setIsSendingMetrics(false);
    }
  };

  const terminateEnvironment = async (idToTerminate: string) => {
    if (!idToTerminate) return alert("Pilih JobID yang akan dihapus.");
    if (!confirm(`Yakin ingin menyetop dan membebaskan resource Env ${idToTerminate}?`)) return;

    try {
      const res = await fetch('/api/env/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: idToTerminate }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        if (jobId === idToTerminate) setJobId('');
      } else {
        alert(`Gagal Terminate: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Koneksi Gagal: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header Navbar */}
      <header className="bg-slate-950 border-b border-slate-800 shadow-sm sticky top-0 z-10 px-8 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-indigo-600/30">IT</div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tight">
              IT LaaS
            </h1>
          </div>
          <div className="flex items-center gap-3 transition-colors duration-300">
            {serverStatus === 'checking' ? (
               <span className="flex h-3 w-3 items-center justify-center">
                 <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-slate-500 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
               </span>
            ) : serverStatus === 'online' ? (
              <span className="flex h-3 w-3 items-center justify-center" title="Server is Ready">
                <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : (
              <span className="flex h-3 w-3 items-center justify-center" title="Server is Unreachable">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
              </span>
            )}
            
            <div className="flex flex-col">
              <span className={`text-sm font-bold uppercase tracking-widest ${serverStatus === 'online' ? 'text-emerald-400' : serverStatus === 'offline' ? 'text-red-500' : 'text-slate-400'}`}>
                {serverStatus === 'checking' ? 'Connecting...' : serverStatus === 'online' ? 'System Online' : 'System Offline'}
              </span>
              {serverStatus === 'offline' && <span className="text-[10px] text-red-400/80 -mt-1">Backend gRPC Disconnected</span>}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-10">
        <p className="text-slate-400 mb-10 text-lg leading-relaxed max-w-2xl">
          Eksplorasi dan berinteraksi secara real-time dengan microservice. UI ini mendemonstrasikan <span className="text-indigo-400 font-medium">Unary</span>, <span className="text-teal-400 font-medium">Server-side Streaming</span>, dan <span className="text-fuchsia-400 font-medium">Client-side Streaming</span>.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card 1: Unary */}
          <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl transition-all hover:shadow-indigo-900/10 hover:border-indigo-500/30 flex flex-col">
            <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-500/20 rounded text-indigo-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  Unary RPC
                </h2>
                <span className="text-xs font-mono bg-slate-900 text-slate-400 px-2 py-1 rounded">RequestEnvironment</span>
              </div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <p className="text-sm text-slate-400 mb-6">Kirim request tunggal. Server akan memberikan <code className="text-indigo-300">JobID</code>.</p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">NIM Mahasiswa</label>
                  <input 
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors" 
                    value={studentId} onChange={(e) => setStudentId(e.target.value)} 
                    placeholder="Contoh: NIM112233"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Environment / Image</label>
                  <select 
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors appearance-none" 
                    value={envType} onChange={(e) => setEnvType(e.target.value)} 
                  >
                    <option value="" disabled>Pilih Environment...</option>
                    <option value="DataScience_Python">DataScience_Python - 2 CPU, 4GB RAM (Jupyter, Pandas, Sklearn)</option>
                    <option value="Database_MySQL">Database_MySQL - 1 CPU, 2GB RAM (MySQL, phpMyAdmin)</option>
                    <option value="WebServer_NodeJS">WebServer_NodeJS - 1 CPU, 1GB RAM (NodeJS, npm, Apache/Nginx)</option>
                    <option value="Network_Lab">Network_Lab - 2 CPU, 2GB RAM (Wireshark, GNS3)</option>
                    <option value="FullStack_Dev">FullStack_Dev - 4 CPU, 8GB RAM (Docker, Nginx)</option>
                    <option value="ML_Training">ML_Training - 4 CPU, 16GB RAM (TensorFlow, PyTorch, CUDA)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Tujuan / Prioritas</label>
                  <select 
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors appearance-none" 
                    value={purpose} onChange={(e) => setPurpose(e.target.value)} 
                  >
                    <option value="" disabled>Pilih Prioritas...</option>
                    <option value="tugas_akhir">Tugas Akhir (Prioritas Tinggi)</option>
                    <option value="praktikum">Praktikum (Prioritas Sedang)</option>
                    <option value="umum">Umum (Prioritas Rendah)</option>
                  </select>
                </div>
              </div>
              
              <div className="mt-auto">
                <button 
                  className="w-full bg-indigo-600/90 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 py-3 px-4 rounded-xl font-semibold transition-all active:scale-[0.98]"
                  onClick={requestEnvironment}
                >
                  Eksekusi Request Unary
                </button>
                <div className="mt-4 bg-slate-950 rounded-xl p-4 border border-slate-800 h-[88px] overflow-y-auto">
                  <span className="text-xs text-slate-500 font-mono block mb-1">Response Output</span>
                  <div className="text-sm text-indigo-300 font-mono break-words">{unaryResponse || '-'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Server-Side Stream */}
          <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl transition-all hover:shadow-teal-900/10 hover:border-teal-500/30 flex flex-col">
            <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <div className="p-1.5 bg-teal-500/20 rounded text-teal-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  </div>
                  Server-side Stream
                </h2>
                <span className="text-xs font-mono bg-slate-900 text-slate-400 px-2 py-1 rounded">MonitorProvisioning</span>
              </div>
            </div>
            <div className="p-6 flex flex-col flex-1">
              <p className="text-sm text-slate-400 mb-6">Gunakan <code className="text-teal-300">JobID</code> untuk mendengarkan progress logs dari server secara real-time.</p>
              
              <div className="mb-6">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Target Job ID</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    className="flex-1 bg-slate-900 border border-slate-700 text-slate-400 px-4 py-2.5 rounded-lg cursor-not-allowed font-mono" 
                    value={jobId} readOnly placeholder="Belum ada Job ID (Request Unary dulu)"
                  />
                  <div className="flex gap-2">
                    <button 
                      className="flex-1 sm:flex-none border border-teal-600/30 bg-teal-600/10 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/20 py-2.5 px-5 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] whitespace-nowrap"
                      onClick={monitorProvisioning}
                      disabled={isProvisioning || !jobId}
                    >
                      {isProvisioning ? 'Listening...' : 'Mulai Stream'}
                    </button>
                    <button 
                      className="border border-red-800/50 bg-red-900/20 hover:bg-red-600 text-white shadow-lg shadow-red-900/20 py-2.5 px-4 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                      onClick={() => terminateEnvironment(jobId)}
                      disabled={!jobId}
                      title="Matikan Env. Ini & Bersihkan Resource"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Terminal-like Logs Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 min-h-[220px] flex flex-col shadow-inner">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                  <span className="text-[10px] text-slate-600 font-mono ml-2 uppercase tracking-wider">Server Logs</span>
                </div>
                <div className="flex-1 font-mono text-sm overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 pl-1 pb-2">
                  {logs.length === 0 ? (
                    <p className="text-slate-600 italic flex items-center h-full animate-pulse">// Standby for incoming stream...</p>
                  ) : null}
                  {logs.map((log, i) => (
                    <div key={i} className="text-teal-400/90 leading-tight">
                      <span className="text-slate-600 mr-2">➜</span>{log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Client-Side Stream (Full Width) */}
          <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl transition-all hover:shadow-fuchsia-900/10 hover:border-fuchsia-500/30 lg:col-span-2 flex flex-col">
            <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <div className="p-1.5 bg-fuchsia-500/20 rounded text-fuchsia-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </div>
                  Client-side Stream
                </h2>
                <span className="text-xs font-mono bg-slate-900 text-slate-400 px-2 py-1 rounded">ReportMetrics</span>
              </div>
            </div>
            
            <div className="p-6 md:flex md:gap-8 items-center">
              <div className="md:w-1/2 mb-6 md:mb-0">
                <p className="text-sm text-slate-400 mb-4">Klien akan memompa serangkaian data metrik (CPU & RAM usage) secara berurutan ke server. Server kemudian menampungnya, lalu memberikan kembalian akhir *Acknowledgment* saja di akhir pipeline stream.</p>
                <button 
                  className="w-full sm:w-auto bg-fuchsia-600/90 hover:bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-600/20 py-3 px-6 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] flex justify-center items-center gap-3"
                  onClick={startSendingMetrics}
                  disabled={isSendingMetrics}
                >
                  {isSendingMetrics ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Transmitting Data...
                    </>
                  ) : 'Kirim Stream Metrik Beruntun'}
                </button>
              </div>
              
              <div className="md:w-1/2 bg-slate-950 border border-slate-800 rounded-xl p-5 min-h-[220px] flex flex-col justify-between shadow-inner relative overflow-hidden group">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                <div className="relative z-10 w-full flex flex-col h-full">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3 text-center">Transmisi CPU & RAM (Outbound)</span>
                  
                  {/* Daftar Stream Data */}
                  <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2 mb-3 min-h-[100px] scrollbar-thin scrollbar-thumb-slate-800">
                    {sentMetrics.length === 0 && !isSendingMetrics ? (
                      <div className="text-center text-slate-600 mt-6 select-none opacity-50 italic"> Menunggu inisiasi stream... </div>
                    ) : null}
                    
                    {sentMetrics.map((m, i) => (
                      <div key={i} className="flex justify-between items-center bg-slate-900/80 border border-slate-800/80 p-2.5 rounded-lg shadow-sm">
                        <span className="text-fuchsia-400 font-semibold flex items-center gap-1.5"><span className="text-slate-500">↑</span> {m.server_id}</span>
                        <div className="flex gap-4">
                          <span className="text-emerald-400">CPU: <span className="text-slate-300">{m.cpu_usage}%</span></span>
                          <span className="text-cyan-400">RAM: <span className="text-slate-300">{m.ram_usage}%</span></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Respon Akhir */}
                  <div className="text-center font-mono text-sm border-t border-slate-800/60 pt-4 mt-auto">
                    {metricsResponse ? (
                      <span className="text-fuchsia-300 bg-fuchsia-400/10 px-4 py-2.5 rounded-lg inline-block border border-fuchsia-500/20 ring-1 ring-fuchsia-400/30 w-full shadow-lg shadow-fuchsia-900/20">
                        {metricsResponse}
                      </span>
                    ) : isSendingMetrics ? (
                      <span className="text-slate-500 animate-pulse block text-xs">Sedang mengirim stream ke server backend...</span>
                    ) : (
                      <span className="text-slate-600 block text-xs tracking-wider">Target Ack Response</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Card 4: Active Environments List */}
          <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl lg:col-span-2 flex flex-col">
            <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/20 rounded text-blue-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                </div>
                Real-time Server State
              </h2>
              <div className="flex gap-4 items-center bg-slate-950 px-4 py-2 rounded-lg border border-slate-800">
                <div className="text-sm">
                  <span className="text-slate-400 uppercase text-[10px] font-bold tracking-widest block mb-0.5">Avail. CPU</span>
                  <span className="text-emerald-400 font-mono font-bold">{labState.availableCpu.toFixed(1)} / 16.0</span>
                </div>
                <div className="w-px h-6 bg-slate-800"></div>
                <div className="text-sm">
                  <span className="text-slate-400 uppercase text-[10px] font-bold tracking-widest block mb-0.5">Avail. RAM</span>
                  <span className="text-cyan-400 font-mono font-bold">{labState.availableRam.toFixed(1)} / 64.0</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              {labState.activeJobs.length === 0 ? (
                <div className="text-center text-slate-500 py-8 italic border border-dashed border-slate-700/50 rounded-xl">
                  Tidak ada job aktif di server saat ini.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-slate-400 uppercase tracking-wide text-xs">
                        <th className="pb-3 px-4 font-semibold">Tujuan</th>
                        <th className="pb-3 px-4 font-semibold">JobID</th>
                        <th className="pb-3 px-4 font-semibold">Mahasiswa</th>
                        <th className="pb-3 px-4 font-semibold">Status / Waktu</th>
                        <th className="pb-3 px-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {labState.activeJobs.map((env) => (
                        <tr key={env.jobId} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-4 px-4 text-slate-400 capitalize">{env.purpose.replace('_', ' ')}</td>
                          <td className="py-4 px-4 font-mono text-indigo-300">{env.jobId}</td>
                          <td className="py-4 px-4 text-slate-300">{env.studentId}</td>
                          <td className="py-4 px-4">
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex w-fit px-2 py-0.5 rounded text-xs font-semibold ${env.status === 'Running' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'}`}>
                                {env.status}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono" title={env.startTime}>{new Date(env.startTime).toLocaleTimeString()}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4 flex justify-end gap-2">
                            <button 
                              className="bg-indigo-600/20 text-indigo-400 hover:bg-indigo-500 hover:text-white border border-indigo-600/30 px-3 py-1.5 rounded-lg transition-all text-xs font-semibold"
                              onClick={() => setJobId(env.jobId)}
                            >
                              Log
                            </button>
                            <button 
                              className="bg-red-900/20 text-red-400 hover:bg-red-600 hover:text-white border border-red-800/50 px-3 py-1.5 rounded-lg transition-all text-xs font-semibold"
                              onClick={() => terminateEnvironment(env.jobId)}
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
