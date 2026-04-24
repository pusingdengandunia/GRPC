import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

let socket;

const TOTAL_CPU = 16;
const TOTAL_RAM = 64;

const ENV_OPTIONS = [
  { value: 'DataScience_Python', label: 'DataScience Python', spec: '2 CPU / 4 RAM' },
  { value: 'Database_MySQL', label: 'Database MySQL', spec: '1 CPU / 2 RAM' },
  { value: 'WebServer_NodeJS', label: 'WebServer NodeJS', spec: '1 CPU / 1 RAM' },
  { value: 'Network_Lab', label: 'Network Lab', spec: '2 CPU / 2 RAM' },
  { value: 'FullStack_Dev', label: 'FullStack Dev', spec: '4 CPU / 8 RAM' },
  { value: 'ML_Training', label: 'ML Training', spec: '4 CPU / 16 RAM' },
];

const PURPOSE_OPTIONS = [
  { value: 'tugas_akhir', label: 'Tugas Akhir', priority: 'Prioritas Tinggi - Bobot 3' },
  { value: 'praktikum', label: 'Praktikum', priority: 'Prioritas Menengah - Bobot 2' },
  { value: 'umum', label: 'Umum', priority: 'Prioritas Rendah - Bobot 1' },
];

function App() {
  const [studentId, setStudentId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [jwtToken, setJwtToken] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [connectionState, setConnectionState] = useState('disconnected');
  
  // State publik dan privat berbasis sesi
  const [labStatus, setLabStatus] = useState({ availableCpu: 16, availableRam: 64, activeJobs: [] });
  const [ownedJobs, setOwnedJobs] = useState([]);
  const [privateMetrics, setPrivateMetrics] = useState({});
  const [logs, setLogs] = useState([]);
  const [alert, setAlert] = useState(null);
  const [scaleDrafts, setScaleDrafts] = useState({});

  // Form State Default
  const [envType, setEnvType] = useState('DataScience_Python');
  const [purpose, setPurpose] = useState('praktikum');

  const activeJobCount = labStatus.activeJobs?.length ?? 0;
  const usedCpu = Math.max(0, TOTAL_CPU - Number(labStatus.availableCpu || 0));
  const usedRam = Math.max(0, TOTAL_RAM - Number(labStatus.availableRam || 0));
  const cpuUsagePercent = Math.min(100, (usedCpu / TOTAL_CPU) * 100);
  const ramUsagePercent = Math.min(100, (usedRam / TOTAL_RAM) * 100);

  useEffect(() => {
    if (!isLoggedIn || !jwtToken) return;

    // Connect ke Gateway WS saat login
    socket = io('http://localhost:4000', {
      auth: { token: jwtToken }
    });

    socket.on('connect', () => setConnectionState('connected'));
    socket.on('disconnect', () => setConnectionState('disconnected'));
    socket.on('connect_error', (err) => {
      setConnectionState('error');
      setAuthError(err.message || 'Koneksi WebSocket gagal.');
    });

    // Event 1: Data publik dari server
    socket.on('public_lab_status', (data) => {
      setLabStatus(data);
    });

    // Event 2: Data privat berdasarkan sesi mahasiswa
    socket.on('private_lab_state', (payload) => {
      const incomingJobs = payload.ownedJobs || [];
      setOwnedJobs(incomingJobs);

      const nextMetrics = payload.metrics || [];
      if (!nextMetrics.length) return;

      setPrivateMetrics((prev) => {
        const updated = { ...prev };

        nextMetrics.forEach((metric) => {
          const existingSeries = updated[metric.jobId] || [];
          const trimmed = [...existingSeries, metric].slice(-14);
          updated[metric.jobId] = trimmed;
        });

        return updated;
      });

      setScaleDrafts((prev) => {
        const next = { ...prev };
        incomingJobs.forEach((job) => {
          if (!next[job.jobId]) {
            const env = ENV_OPTIONS.find((item) => item.value === job.envType);
            const [cpuSpec, ramSpec] = env?.spec?.split('/') || [];
            const fallbackCpu = Number(cpuSpec?.replace(' CPU', '').trim()) || 1;
            const fallbackRam = Number(ramSpec?.replace(' RAM', '').trim()) || 1;
            next[job.jobId] = { newCpu: fallbackCpu, newRam: fallbackRam };
          }
        });
        return next;
      });
    });

    // Event 3: Stream provisioning privat
    socket.on('private_provision_log', (log) => {
      const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
      setLogs((prev) => [...prev, `[${time}] [${log.progress}%] ${log.status}`].slice(-120));
    });

    // Event 4: Server-Initiated targeted alert
    socket.on('server_alert', (data) => {
      setAlert(data);
      setTimeout(() => setAlert(null), 6000); // Alert hilang dalam 6 detik
    });

    socket.on('session_ready', () => {
      setConnectionState('connected');
    });

    return () => socket.disconnect();
  }, [isLoggedIn, jwtToken]);

  const handleDeploy = () => {
    setLogs([]); // Reset log terminal tiap deploy baru
    socket.emit('request_env', { envType: envType, purpose: purpose });
  };

  const handleScale = (jobId) => {
    const payload = scaleDrafts[jobId];
    if (!payload) return;

    socket.emit('scale_env', {
      jobId,
      newCpu: Number(payload.newCpu),
      newRam: Number(payload.newRam),
    });
  };

  const handleScaleDraftChange = (jobId, key, value) => {
    setScaleDrafts((prev) => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        [key]: value,
      },
    }));
  };

  const handleLogin = async () => {
    if (!studentId.trim()) return;
    setAuthLoading(true);
    setAuthError('');

    try {
      const res = await fetch('http://localhost:4000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentId.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.token) {
        throw new Error(data.message || 'Login gagal.');
      }

      setJwtToken(data.token);
      setIsLoggedIn(true);
      setConnectionState('connecting');
    } catch (err) {
      setAuthError(err.message || 'Autentikasi gagal.');
    } finally {
      setAuthLoading(false);
    }
  };

  const ownActive = ownedJobs.filter((job) => job.status === 'Running').length;
  const ownQueued = ownedJobs.filter((job) => job.status !== 'Running').length;
  const runningOwnedJobs = ownedJobs.filter((job) => job.status === 'Running');

  if (!isLoggedIn) {
    return (
      <div className="laas-shell login-shell">
        <div className="login-card">
          <p className="eyebrow">LaaS Gateway</p>
          <h1>Login Kampus Lab</h1>
          <p className="muted">Masuk dengan identitas mahasiswa untuk mengakses lingkungan praktikum.</p>
          <input
            type="text"
            placeholder="Student ID (contoh: MHS-001)"
            className="laas-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          />
          <button onClick={handleLogin} className="btn btn-primary" disabled={!studentId.trim() || authLoading}>
            {authLoading ? 'Memproses Login...' : 'Masuk Sistem'}
          </button>
          {authError && <p className="auth-error">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="laas-shell dashboard-shell">
      
      {/* SERVER INITIATED EVENT: Toast Alert */}
      {alert && (
        <div className={`toast-alert ${
          alert.type === 'error' ? 'toast-error' : 
          alert.type === 'info' ? 'toast-info' : 
          'toast-success'
        }`}>
          {alert.message}
        </div>
      )}

      <header className="dashboard-topbar">
        <div>
          <p className="eyebrow">Realtime Operations</p>
          <h1>Lab-as-a-Service Dashboard</h1>
        </div>
        <div className="topbar-stack">
          <div className={`ws-indicator ws-${connectionState}`}>
            WS: {connectionState}
          </div>
          <div className="user-chip">
            Logged in as <strong>{studentId}</strong>
          </div>
        </div>
      </header>

      {/* PUBLIC VIEW */}
      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-title">Publik: Ketersediaan CPU</div>
          <div className="metric-value">
            {Number(labStatus.availableCpu || 0).toFixed(1)} <span>/ {TOTAL_CPU}.0 Cores</span>
          </div>
          <div className="meter-track">
            <div className="meter-fill cpu" style={{ width: `${cpuUsagePercent}%` }} />
          </div>
          <p className="metric-footnote">Terpakai: {usedCpu.toFixed(1)} cores</p>
        </article>

        <article className="metric-card">
          <div className="metric-title">Publik: Ketersediaan RAM</div>
          <div className="metric-value">
            {Number(labStatus.availableRam || 0).toFixed(1)} <span>/ {TOTAL_RAM}.0 GB</span>
          </div>
          <div className="meter-track">
            <div className="meter-fill ram" style={{ width: `${ramUsagePercent}%` }} />
          </div>
          <p className="metric-footnote">Terpakai: {usedRam.toFixed(1)} GB</p>
        </article>

        <article className="metric-card summary-card">
          <div className="metric-title">Privat: Ringkasan Sesi Saya</div>
          <div className="summary-stack">
            <p>
              Job aktif <strong>{activeJobCount}</strong>
            </p>
            <p>
              Milik saya running <strong>{ownActive}</strong>
            </p>
            <p>
              Milik saya antre <strong>{ownQueued}</strong>
            </p>
          </div>
        </article>
      </section>

      <section className="public-table-card">
        <h2>Live Activity (Publik)</h2>
        <div className="activity-list">
          {labStatus.activeJobs?.slice(0, 8).map((job) => (
            <div key={job.jobId} className="activity-row">
              <span>{job.studentId}</span>
              <span>{job.envType}</span>
              <span className={`job-status ${job.status === 'Running' ? 'running' : 'queued'}`}>{job.status}</span>
            </div>
          ))}
          {(!labStatus.activeJobs || labStatus.activeJobs.length === 0) && (
            <div className="jobs-empty">Belum ada aktivitas lab publik saat ini.</div>
          )}
        </div>
      </section>

      <section className="control-grid">
        
        {/* COMMAND & CONTROL */}
        <div className="panel-card">
          <h2>Deploy Environment</h2>
          <p className="muted mb-5">Pilih template environment dan tujuan penggunaan sebelum provisioning.</p>
          
          <label className="input-label">Jenis Environment</label>
          <select className="laas-input" value={envType} onChange={(e)=>setEnvType(e.target.value)}>
            {ENV_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.spec})
              </option>
            ))}
          </select>

          <label className="input-label">Tujuan dan Prioritas</label>
          <select className="laas-input" value={purpose} onChange={(e)=>setPurpose(e.target.value)}>
            {PURPOSE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.priority})
              </option>
            ))}
          </select>

          <button onClick={handleDeploy} className="btn btn-success">
            Deploy Sekarang
          </button>
        </div>

        {/* STREAMING LOG PRIVAT */}
        <div className="terminal-card">
          <div className="terminal-head">
            Terminal Provisioning Agent (Privat)
          </div>
          <div className="terminal-stream">
            {logs.map((log, i) => (
              <div key={i} className="terminal-line">
                <span>&gt;</span>{log}
              </div>
            ))}
            {logs.length === 0 && <div className="terminal-empty">Menunggu instruksi deployment...</div>}
          </div>
        </div>
      </section>

      <section className="private-metric-card">
        <h2>Grafik Resource Per Agent Env (Privat)</h2>
        {runningOwnedJobs.length > 0 ? (
          <div className="metric-series-grid per-agent-grid">
            {runningOwnedJobs.map((job) => {
              const series = privateMetrics[job.jobId] || [];
              return (
                <article key={job.jobId} className="agent-metric-card">
                  <p className="chart-label chart-title">{job.jobId} • {job.envType}</p>
                  <p className="chart-label">CPU Usage %</p>
                  <div className="sparkline-row">
                    {series.map((point, idx) => (
                      <div
                        key={`${job.jobId}-cpu-${idx}`}
                        className="sparkline-bar cpu"
                        style={{ height: `${Math.max(8, point.cpuUsage)}%` }}
                        title={`CPU ${point.cpuUsage}%`}
                      />
                    ))}
                  </div>
                  <p className="chart-label mt-small">RAM Usage %</p>
                  <div className="sparkline-row">
                    {series.map((point, idx) => (
                      <div
                        key={`${job.jobId}-ram-${idx}`}
                        className="sparkline-bar ram"
                        style={{ height: `${Math.max(8, point.ramUsage)}%` }}
                        title={`RAM ${point.ramUsage}%`}
                      />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="jobs-empty">Belum ada agent running milikmu untuk ditampilkan metriknya.</div>
        )}
      </section>

      {/* JOBS PRIVAT + KONTROL SCALE/TERMINATE */}
      <section className="jobs-section">
        <h2>Lingkungan Milik Saya</h2>
        <div className="jobs-grid">
          {ownedJobs?.map((job, i) => (
            <article key={i} className={`job-card ${
              job.status === 'Running' 
                ? 'job-running' 
                : 'job-queued'
            }`}>
              <div>
                <div className="job-headline">
                  <span className="job-id">{job.jobId}</span>
                  <span className="job-env">{job.envType}</span>
                </div>
                <div className="job-meta">
                  Milik {job.studentId} • Tujuan {job.purpose}
                </div>

                <div className="scale-form">
                  <label className="scale-label">CPU</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    className="laas-input scale-input"
                    value={scaleDrafts[job.jobId]?.newCpu ?? ''}
                    onChange={(e) => handleScaleDraftChange(job.jobId, 'newCpu', e.target.value)}
                  />
                  <label className="scale-label">RAM</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="laas-input scale-input"
                    value={scaleDrafts[job.jobId]?.newRam ?? ''}
                    onChange={(e) => handleScaleDraftChange(job.jobId, 'newRam', e.target.value)}
                  />
                </div>
              </div>
              <div className="job-actions">
                <span className={`job-status ${job.status === 'Running' ? 'running' : 'queued'}`}>
                  {job.status}
                </span>

                <button onClick={() => handleScale(job.jobId)} className="btn btn-secondary">
                  Request Scale
                </button>
                <button
                  onClick={() => socket.emit('terminate_env', job.jobId)}
                  className="btn btn-danger"
                >
                  Terminate
                </button>
              </div>
            </article>
          ))}
          {(!ownedJobs || ownedJobs.length === 0) && (
            <div className="jobs-empty">
              Belum ada environment milikmu saat ini.
            </div>
          )}
        </div>
      </section>

    </div>
  );
}

export default App;