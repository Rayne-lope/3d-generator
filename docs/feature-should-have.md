# Feature Roadmap & Implementation Guide: Web Studio Enhancements

Dokumen ini merangkum rencana arsitektur dan spesifikasi teknis untuk meningkatkan web viewport **AI 3D Asset Studio** (`http://127.0.0.1:5178/`), dengan fokus utama pada **In-Browser AI Copilot (Headless CLI Bridge)** dan peningkatan alur kerja 3D.

---

## 1. Fitur Utama: In-Browser AI Copilot (Headless CLI Bridge)

### 1.1 Konsep & Alur Kerja
Memungkinkan pengguna mengetik perintah revisi atau pembuatan varian langsung dari browser tanpa perlu membuka terminal atau membayar API key terpisah.

```
┌────────────────────────────────────────────────────────┐
│                   Browser (Frontend)                   │
│   Prompt input: "pertebal larasnya dan tambah scope"   │
└──────────────────────────┬─────────────────────────────┘
                           │ POST /api/agent/revise
                           ▼
┌────────────────────────────────────────────────────────┐
│         Studio Dev Server (studio/server/server.js)     │
│   Node.js menerima request & menjalankan child_process │
└──────────────────────────┬─────────────────────────────┘
                           │ spawn('claude', ['-p', ...])
                           ▼
┌────────────────────────────────────────────────────────┐
│                 Local CLI (Background)                 │
│   Claude Code / Antigravity mengeksekusi instruksi:    │
│   /asset-revise <slug> "<prompt>"                      │
│   (Memakai akun/sesi aktif di mesin lokal)            │
└──────────────────────────┬─────────────────────────────┘
                           │ Mengedit file assets/<slug>/asset.js
                           ▼
┌────────────────────────────────────────────────────────┐
│             File Watcher + Live Reload                 │
│   Studio mendeteksi perubahan → Rebuild GLB            │
│   Mengirim event SSE → Viewport 3D otomatis update     │
└────────────────────────────────────────────────────────┘
```

### 1.2 Rancangan Endpoint Backend (`studio/server/server.js`)
Tambahkan rute API baru di server Node.js:

* **Endpoint:** `POST /api/agent/command`
* **Request Body:**
  ```json
  {
    "slug": "glock-17",
    "prompt": "buat larasnya lebih panjang 5cm",
    "action": "revise" // "revise" | "variant" | "skin"
  }
  ```
* **Contoh Implementasi Handler (Node.js):**
  ```javascript
  import { spawn } from 'node:child_process';

  // Queue agar tidak ada dua proses CLI berjalan bersamaan
  let isAgentRunning = false;

  export function handleAgentCommand(req, res) {
    if (isAgentRunning) {
      return res.status(429).json({ error: 'Proses AI sebelumnya masih berjalan...' });
    }

    const { slug, prompt, action = 'revise' } = req.body;
    const commandText = action === 'revise' 
      ? `/asset-revise ${slug} "${prompt}"` 
      : `/asset "${prompt}"`;

    isAgentRunning = true;

    // Memanggil CLI lokal secara headless
    // Gunakan 'claude' dengan flag non-interaktif (-p)
    const proc = spawn('claude', ['-p', commandText], {
      cwd: process.cwd(),
      shell: true,
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      isAgentRunning = false;
      if (code === 0) {
        res.json({ ok: true, output: stdout });
      } else {
        res.status(500).json({ ok: false, error: stderr || stdout });
      }
    });
  }
  ```

### 1.3 Komponen UI Frontend (`studio/viewport/index.html` & `app.js`)
* **Floating Prompt Bar:** Letakkan di bagian bawah viewport kanvas 3D.
* **Elemen UI:**
  * Input text box dengan placeholder: *"Instruksi revisi model (mis: pertebal pegangan)..."*
  * Tombol **Kirim** (Shortcut: `Enter`)
  * Indikator **Loading Spinner**: *"AI sedang merevisi [nama-aset]..."*
  * Quick Chips (tombol cepat):
    * `+ Tambah Detail`
    * `+ Lebih Ramping`
    * `+ Lebih Tebal`
    * `Undo Perubahan`

---

## 2. Universal Parameter Inspector (Auto-Sliders dari `params`)

### 2.1 Masalah Saat Ini
Tab **Edit** saat ini hanya mendukung 3 aset uji coba (*pilot assets*). Untuk aset lainnya, nilai `params` tidak bisa diubah langsung dari UI.

### 2.2 Solusi
Buat inspector dinamis yang membaca definisi `params` di file `asset.js`:
* **Tipe Angka (`number`):** Render slider `<input type="range">` dan number box.
* **Tipe Warna Hex (`#rrggbb`):** Render color-picker `<input type="color">`.
* **Tipe Boolean (`boolean`):** Render tombol sakelar ON/OFF.
* **Tipe Pilihan (`array` / `enum`):** Render `<select>` dropdown.

---

## 3. Visual Gallery & Thumbnails di Sidebar

> **Status: selesai (tahap 3).** Thumbnail dirender di browser dari GLB generic tiap asset, di-cache per hash GLB di `.studio/thumbs/`, dan tampil di daftar Assets serta library scene.

### 3.1 Masalah Saat Ini
Sidebar kiri hanya memuat daftar teks dari 100+ aset. Sulit mengenali model hanya dari nama teks.

### 3.2 Solusi
* Saat aset selesai di-build, studio sudah memiliki lembar review atau bisa menghasilkan thumbnail PNG 128×128.
* Tampilkan kartu thumbnail kecil di samping nama aset di sidebar:
  ```html
  <div class="asset-card">
    <img src="/api/assets/glock-17/thumbnail.png" loading="lazy" />
    <span class="name">glock-17</span>
    <span class="triangles">4.2k tris</span>
  </div>
  ```

---

## 4. Reference Image Overlay di Kanvas 3D

### 4.1 Kegunaan
Seringkali saat membuat model (seperti senjata atau karakter), kita punya gambar referensi 2D (`reference.png`).

### 4.2 Fitur yang Dibutuhkan:
* Toggle **"Reference Overlay"** di toolbar atas.
* Menampilkan gambar `assets/<slug>/reference.png` semi-transparan tepat di belakang model 3D saat kamera berada pada sudut **Side View** atau **Front View**.
* Slider **Opacity / Transparansi** (0% – 100%) agar modeler bisa mencocokkan siluet 3D dengan gambar referensi secara visual.

---

## 5. Fitur Spesifik Roblox Developer (QoL)

### 5.1 Roblox Dummy Scale (R15 & R6)

> **Status: selesai (tahap 3).** Pilihan figur di top bar: Human 1.75 m, Roblox R6, Roblox R15 (tinggi 5,1 stud). Tombol H berpindah antar pilihan.
* Mengganti atau menambahkan opsi di samping tombol `Human`:
  * `Human (1.75m)`
  * `Roblox R15 Dummy`
  * `Roblox R6 Dummy`
* Menaruh dummy tepat di samping objek untuk memastikan skala senjata atau prop pas di genggaman tangan karakter Roblox.

### 5.2 One-Click Roblox Publish
* Di tab Export, tambahkan tombol **"Publish to Roblox"**.
* Ketika diklik, server memanggil:
  `node studio publish <slug> --roblox`
* Menampilkan feedback langsung di web: ID Asset Roblox dan link ke Asset Manager.

---

## 6. Exploded View & Part Hierarchy Inspector

### 6.1 Exploded View Slider
* Slider di bagian atas kanvas (0% hingga 100%).
* Ketika digeser, setiap `k.part` bergerak menjauh dari titik tengah (origin) berdasarkan vektor posisinya.
* Sangat berguna untuk melihat komponen dalam (mekanisme dalam senjata, struktur ruangan di gedung).

### 6.2 Click-to-Inspect
* Ketika user mengklik salah satu bagian mesh di viewport 3D menggunakan raycaster Three.js:
  * Bagian tersebut menyala (*highlight outline*).
  * Panel samping menampilkan:
    * Nama Part: `k.part('slide')`
    * Poligon: `1,240 triangles`
    * Material: `mat_metal (Roughness: 0.35, Metalness: 0.9)`

---

## 7. Urutan Langkah Implementasi yang Disarankan

1. **Tahap 1 (Quick Win): In-Browser Prompt Bar**
   - Tambahkan form prompt di `studio/viewport/index.html`.
   - Buat endpoint `POST /api/agent/command` di `studio/server/server.js`.
   - Hubungkan ke `claude -p` headless mode.
2. **Tahap 2: Visual Sidebar Thumbnails**
   - Buat endpoint untuk menyajikan thumbnail/snapshot aset.
   - Perbarui tampilan CSS sidebar `studio/viewport/styles.css`.
3. **Tahap 3: Reference Image Overlay & Roblox Dummy**
   - Tambahkan layer plane Three.js untuk `reference.png` di kamera orthographic.
   - Tambahkan mesh dummy avatar Roblox.
4. **Tahap 4: Universal Params Inspector**
   - Perluas modul `studio/viewport/editor.js` agar menghasilkan kontrol untuk semua aset.

---

## 8. Scene Composer (Pembuat Map & Ruangan Utuh)

> **Status: versi pertama selesai (tahap 3).** Lihat [SCENES.md](SCENES.md). Sudah ada: library, taruh/geser/putar, snapping grid-dinding-stack, plan view, shell ruangan dari ukuran, autosave, undo/redo, versi, export satu GLB (tiap instance node sendiri), dan skill `/scene` untuk AI draft. Belum ada: walkthrough view dan layout `.rbxmx` berbasis asset ter-publish (lihat catatan di 8.3).

Fitur ini adalah evolusi dari pembuatan barang satuan menjadi **perakitan 1 lingkungan game utuh (misal: Lobby, Dungeon, Ruang Tunggu)**. Fitur ini menyambung langsung dengan fokus **Tahap 3 (Library + Scene Assembly)**.

### 8.1 Gambaran Besar: Konsep "Merakit Lego"
Alih-alih membuat map sebagai 1 objek raksasa yang kaku, sistem membaginya menjadi 3 lapisan:
1. **Struktur Dasar:** Dinding, lantai, dan langit-langit ruangan.
2. **Koleksi Barang (Library):** Perabotan yang diambil dari aset yang sudah ada (kursi, meja, lampu, tanaman).
3. **Denah Koordinat:** Data posisi dan rotasi di mana setiap barang diletakkan.

### 8.2 Bagaimana AI dan Fitur Manual Saling Melengkapi?
* **Langkah 1 (AI Draft / 80% Kerja Cepat):**  
  Pengguna cukup mengetik ide umumnya: *"Buat lobby hotel 15x10 meter dengan meja resepsionis di tengah dan deretan sofa di kiri"*. AI langsung memilih perabotan dari Library dan menatanya ke dalam denah.
* **Langkah 2 (Tahap 3 Assembly / 20% Sentuhan Akhir):**  
  Pengguna melihat hasilnya di web dan menggunakan alat bantu perakitan:
  * **Snapping:** Mengunci posisi barang agar pas menempel di dinding atau lantai tanpa melayang.
  * **Top-Down View:** Melihat dari atas seperti denah arsitektur untuk menata ulang tata letak.
  * **Walkthrough View:** Berjalan di dalam ruangan layaknya karakter game untuk memastikan ruangan tidak terasa sempit.

### 8.3 Hasil Ekspor yang Siap Pakai di Game
* **Untuk Roblox:** Tidak diekspor sebagai satu bongkahan mati, melainkan sebagai file model berstruktur (`.rbxmx`). *Catatan implementasi:* `.rbxmx` tidak bisa memuat data mesh (MeshPart menunjuk asset yang sudah di-upload), jadi versi pertama menulis satu GLB dengan satu node per barang plus `layout.json`; struktur per barang tetap terjaga saat di-import.
* **Manfaatnya di Roblox Studio:** Developer masih bisa menggeser kursi satu per satu, memasang script pintu otomatis, atau menambahkan lampu sorot langsung di Roblox tanpa batasan.

