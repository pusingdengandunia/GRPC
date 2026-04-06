# gRPC Lab Simulation Service

Proyek ini adalah simulasi microservice menggunakan protokol gRPC di Golang. Terdapat 3 jenis komunikasi RPC (Remote Procedure Call) yang diimplementasikan pada proyek ini:

1. **Unary RPC**: `RequestEnvironment` - Klien mengirimkan satu request (permintaan environment lab) dan server mengembalikan satu respons.
2. **Server-side Streaming RPC**: `MonitorProvisioning` - Klien mengirimkan satu request, dan server merespons dengan aliran/stream data (log proses penyediaan environment).
3. **Client-side Streaming RPC**: `ReportMetrics` - Klien mengirimkan stream data secara berkala (metrik penggunaan CPU/RAM), dan server merespons sekali setelah selesai atau menerima data.

## Struktur Direktori
- `pb/` - Berisi file `.pb.go` dan `_grpc.pb.go` hasil kompilasi dari Protocol Buffers (`lab.proto`).
- `client/` - Berisi kode Golang untuk gRPC Client yang akan melakukan *call* ke gRPC Server.
- `server/` - Berisi kode Golang untuk gRPC Server yang merepresentasikan layanan utama (Listening di port `50051`).
- `web-ui/` - Aplikasi web frontend (Next.js & Tailwind CSS) sebagai antarmuka dashboard interaktif untuk klien gRPC.
- `lab.proto` - Definisi kontrak layanan (Service Contract) antar microservice menggunakan syntax proto3.

---

## Prasyarat
Pastikan Anda sudah menginstal:
- [Go](https://go.dev/dl/) versi 1.18 ke atas.
- (Opsional) Protocol Buffers Compiler `protoc` dan plugin `protoc-gen-go` & `protoc-gen-go-grpc` jika Anda ingin meng-compile ulang file `.proto`.

---

## Cara Menjalankan (Run) dan Pengujian (Testing)

Karena ini menggunakan arsitektur *Client-Server*, Anda harus menjalankan **Server** terlebih dahulu sebelum menjalankan **Client**. Disarankan membuka **2 jendela terminal yang berbeda**.

### Langkah 1: Download Dependensi
Buka terminal di root direktori proyek ini, lalu jalankan:
```bash
go mod tidy
```

### Langkah 2: Jalankan gRPC Server
Buka tab/jendela terminal pertama (untuk server):
```bash
# Pindah ke direktori server (opsional, atau gunakan relative path)
go run server/main.go
```
*Output yang diharapkan:* Server akan berjalan dan menginformasikan bahwa ia listening di port `localhost:50051` atau sejenisnya.

### Langkah 3: Jalankan gRPC Client (untuk menguji RPC)
Buka tab/jendela terminal kedua (untuk klien):
```bash
# Jalankan client
go run client/main.go
```

*Output yang diharapkan (alur simulasi client):*
1. **(Client-side stream)** Klien akan memulai pengiriman report metrik (`LAB-RUM-01`) ke server di latar belakang. Anda akan melihat log di server yang menerima laporan metrik ini.
2. **(Unary)** Klien mengirim *Request Environment* untuk `StudentId: NIM12345`. Server menerima request ini dan membalasnya dengan mengembalikan `JobID`.
3. **(Server-side stream)** Setelah mendapakan `JobID`, klien mencoba memanggil *Monitor Provisioning*. Server akan merespons dengan stream status provisioning (seperti: `"Menarik Docker Image..."`, `"Mengekstrak..."`, dll) secara *real-time* ke klien.

Anda bisa memperhatikan log baik di terminal Server maupun terminal Klien secara bersamaan untuk melihat bagaimana proses komunikasi simulasi data ini terjadi!

---

## Menjalankan Web UI (Dashboard Interaktif)

Selain menggunakan `client/main.go` yang berbasis CLI, repositori ini juga menyediakan **Web UI Dashboard** yang dibangun menggunakan Next.js dan Tailwind CSS. Web UI ini akan berinteraksi langsung dengan gRPC Server menggunakan Node.js Server.

### Cara Menjalankan UI:
1. Pastikan Anda sudah menjalankan gRPC Server pada port 50051 (Langkah 2 di atas).
2. Buka terminal baru dan masuk ke folder `web-ui`:
   ```bash
   cd web-ui
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Jalankan *development server*:
   ```bash
   npm run dev
   ```
5. Buka web browser Anda pada alamat **http://localhost:3000**.
6. Anda bisa mensimulasikan panggilan **Request* (Unary), melihat progres logs (Server-Side Streaming dengan SSE), serta *Report Metrics* (Client-Side streaming) secara *real-time* dan interaktif!

---

## (Opsional) Kompilasi Ulang Protobuf
Jika Anda mengubah/memodifikasi kontrak di file `lab.proto`, Anda harus mengkompilasi/generate ulang file go-nya dengan menjalankan:

```bash
protoc --go_out=. --go-grpc_out=. lab.proto
```
*(Pastikan toolchain protobuf sudah ter-install di environment perangkat Anda, atau path ke plugin sudah tersedia sesuai di OS Anda).*