# PRD — AI 3D Asset Studio

Oct 2, 2026 · @moriant

## Ringkasan Produk

AI 3D Asset Studio adalah tool lokal untuk membuat asset 3D game lewat prompt, dengan hasil langsung terlihat di browser dan siap diekspor sebagai GLB.

User memberi prompt lewat CLI atau studio lokal. AI coding agent membuat dan mengubah asset secara procedural dengan Three.js di repo lokal, sedangkan browser hanya menjadi live 3D viewport. Alurnya: **Prompt → Generate → Preview → Revise → Export**.

Prinsip utama:

- Prompt menentukan apa yang dibuat dan bagaimana tampilannya: style, bentuk, proporsi, tema, dan detail.
- Repo menentukan bagaimana membuatnya dengan baik. Rules hanya menjaga kualitas bentuk, keterbacaan, kerapian, performa, struktur asset, dan kesiapan export. Rules tidak boleh memaksakan art style.
- Apa yang terlihat di viewport harus sama dengan apa yang muncul di game engine. Prinsip ini dibahas khusus di bagian Parity Web dan Game Engine.

## Target User dan Keputusan Produk

Target utama adalah game developer dan indie developer yang butuh prop atau environment asset dengan cepat, mulai dari prototyping sampai asset yang cukup rapi untuk dipakai langsung.

Masalah yang diselesaikan: membuat asset 3D sederhana sampai menengah biasanya butuh banyak langkah manual di tool modeling. Studio ini memadatkannya menjadi prompt, preview, revisi, lalu export.

| Area | Keputusan |
| --- | --- |
| Cara generate | AI coding agent membuat dan mengubah asset secara code-driven/procedural dengan Three.js di repo lokal. Bukan Tripo/Meshy, dan bukan AI yang mengoperasikan Blender. |
| Interface | Prompt lewat CLI atau coding studio lokal. Browser hanya menjadi live 3D viewport. |
| Creative direction | Prompt user adalah sumber utama style, bentuk, proporsi, dan detail. Rules repo hanya menjaga best practices dan kualitas. |
| Format export utama | GLB, tersedia sejak Phase 1. |
| Target engine awal | Godot dan Roblox Studio. Engine lain menyusul lewat Engine Profile. |
| Isi file export | Geometry dan material/tekstur yang relevan. Grid, preview lighting, camera helper, background, dan elemen studio tidak ikut. |

## Non-Goals dan Batasan Realistis

V1 sengaja tidak mencoba menjadi pengganti Blender atau tool modeling profesional. Pendekatan code-driven kuat di area tertentu dan lemah di area lain, dan PRD ini tidak menjanjikan kualitas yang sama untuk semua jenis asset.

Non-goals V1:

- Bukan pengganti Blender dan tidak mengejar workflow sculpting profesional.
- Belum fokus pada karakter, rigging, dan animasi.
- Tidak membutuhkan cloud; semuanya berjalan lokal.
- Tidak menjanjikan semua asset organik bisa sempurna secara procedural.

Kekuatan pendekatan ini: hard-surface, props, architecture, modular/environment asset, stylized objects, dan banyak asset game lainnya.

Bukan kekuatan utama: karakter dan creature organik berkualitas tinggi. Saat prompt masuk ke area ini, agent harus menyampaikan batasannya, bukan berpura-pura hasilnya setara.

## Parity Web dan Game Engine

Asset yang bagus di browser tapi aneh di Roblox Studio atau Godot dianggap kegagalan produk, bukan masalah kecil. Aturan intinya: viewport hanya boleh menampilkan apa yang benar-benar ada di file GLB.

**Definisi parity.** Bentuk, proporsi, skala, pivot, UV, warna dasar, dan tekstur harus cocok antara viewport dan engine. Parity tidak berarti pencahayaan pixel-identical, karena tiap engine punya renderer sendiri.

**Penyebab umum dan pencegahannya**

| Penyebab | Contoh | Pencegahan |
| --- | --- | --- |
| Fitur material yang tidak ikut ke GLB | ShaderMaterial, tekstur procedural di shader, efek khusus Three.js | Hanya pakai PBR metallic-roughness standar glTF. Tekstur procedural di-bake menjadi gambar. |
| Pencahayaan viewport menipu | Environment map, tone mapping, dan bayangan membuat asset tampak bagus | Review utama memakai mode netral (lampu sederhana, tanpa trik). Beri peringatan jika asset hanya bagus dengan environment map. |
| Normal dan sisi poligon | Normal terbalik, material double-sided, scale negatif; engine menampilkan sisi yang hilang | Viewport merender single-sided. Validator mengecek normal, arah poligon, dan scale negatif. |
| Skala, sumbu, dan pivot | Satuan berbeda, origin di tengah objek | Satu unit = satu meter, origin di dasar asset, konversi per Engine Profile. |
| Hierarki dan instancing | InstancedMesh, transform bertingkat dengan scale non-uniform | Export meratakan instance dan menolak transform yang tidak bisa diwakili GLB. |
| Batas jumlah triangle | Roblox membatasi triangle per mesh (sekitar 20 ribu; angka ini diverifikasi di Phase 3) | Engine Profile memuat batas; asset besar dipecah atau di-decimate sebelum export. |
| Tekstur | Ukuran terlalu besar, tiling/repeat, UV tumpang tindih, color space keliru | Ukuran maksimum per profil, sRGB untuk warna dan linear untuk data map, tiling di-bake. |
| Transparansi | Urutan render alpha berbeda antar engine | Alpha mode eksplisit (opaque, mask, atau blend); hindari blend kecuali perlu. |

**Mekanisme pencegahan**

1. **Preview = Export.** Setiap generate atau revisi menulis GLB sementara, lalu viewport memuat ulang GLB itu lewat loader bersih. Yang tampil adalah isi file, bukan objek Three.js asli.
2. **Engine Profile.** Satu file aturan per target (Generic GLB, Godot, dan Roblox Studio) berisi batas triangle, ukuran tekstur, fitur material yang boleh, dan konversi skala/sumbu. Default-nya Generic GLB.
3. **Preflight validator.** Sebelum export, GLB dicek dengan validator glTF standar ditambah cek khusus profil. Jika gagal, export diblokir dan agent diminta memperbaiki.
4. **Perbandingan screenshot.** Scene asli dan hasil re-import GLB difoto dari sudut yang sama. Selisih besar menjadi peringatan sebelum export.
5. **Tes di engine sungguhan.** Repo menyertakan proyek referensi Godot dan template place Roblox Studio dengan checklist impor. Keduanya dijalankan pada golden set (kumpulan asset uji) setiap kali rules atau exporter berubah besar.
6. **Laporan export.** Setiap export menampilkan jumlah triangle, material, ukuran tekstur, dimensi, dan peringatan yang tersisa.

**Catatan jalur impor.** Dukungan format impor tiap engine bisa berubah. Di Phase 1 perlu diverifikasi apakah GLB bisa langsung masuk ke Roblox Studio. Jika tidak, sediakan jalur konversi (misalnya FBX atau OBJ) dengan tes parity yang sama.

## Lima Phase

Setiap phase dianggap selesai hanya jika hasilnya bisa didemonstrasikan lewat workflow nyata, tanpa mockup. Setiap phase punya satu kalimat "selesai jika" yang bisa diuji.

### Phase 1 — End-to-End Studio Foundation

Membuktikan alur lengkap prompt → asset → preview → GLB sejak awal. Isinya: CLI/studio lokal, live viewport Three.js, satu contoh asset, export GLB, dan viewport yang memuat ulang GLB hasil export (Preview = Export). Di phase ini juga diputuskan jalur impor ke Godot dan Roblox Studio.

**Selesai jika:** user bisa meminta asset sederhana, melihatnya di browser, lalu membuka file .glb yang sama di Godot dan Roblox Studio dengan bentuk, skala, dan warna yang cocok.

### Phase 2 — General Prompt-to-3D Creation

Agent mampu membuat bermacam asset dari prompt tanpa dikunci ke satu style. Fokusnya menerjemahkan creative brief menjadi geometry dan material yang sesuai intent user, bukan bentuk generik.

**Selesai jika:** sepuluh prompt dengan style berbeda (stylized, low-poly, realistic, fantasy, sci-fi, post-apocalyptic, dan lainnya) menghasilkan asset yang jelas mengikuti prompt masing-masing, dan semuanya bisa diekspor.

### Phase 3 — Quality Knowledge dan Modeling Rules

Repo diberi panduan modeling: shape language, silhouette, proporsi, hierarki detail, material, efisiensi, struktur asset, dan export hygiene. Di phase ini Engine Profile (Generic GLB, Godot, Roblox Studio) dan aturan material standar glTF dibuat. Prompt tetap menang atas keputusan artistik.

**Selesai jika:** pada prompt yang sama, asset yang dibuat dengan rules terlihat lebih rapi daripada tanpa rules (dibandingkan berdampingan), dan Engine Profile menolak asset yang melanggar batasnya.

### Phase 4 — Visual Review dan Iterative Editing

Prompt lanjutan mengubah asset tanpa membangun ulang secara sembarangan. Agent memotret asset dari beberapa sudut (dari hasil re-import GLB), menilainya terhadap prompt awal dan quality rules, lalu memperbaiki masalah yang terlihat. Version history dan undo sederhana masuk di sini, supaya revisi yang merusak tidak menghilangkan versi yang sudah bagus.

**Selesai jika:** tiga prompt revisi berturut-turut pada satu asset (misalnya perbesar satu bagian, ubah proporsi, tambah kerusakan) hanya mengubah yang diminta, dan user bisa kembali ke versi sebelumnya.

### Phase 5 — Production Workflow dan Reliability

Merapikan workflow supaya nyaman dipakai berulang. Isinya: preflight validator penuh, laporan export, perbandingan screenshot otomatis, tes engine pada golden set, organisasi project, statistik asset, dan konsistensi antar revisi.

**Selesai jika:** golden set yang mencakup berbagai tipe dan style asset lolos validasi dan tampil cocok di Godot dan Roblox Studio tanpa perbaikan manual.

## Success Metrics

Tiga metrik utama menjaga produk tetap cepat dan tepercaya. Angka target di bawah adalah usulan awal dan boleh disesuaikan.

| Metrik | Target awal | Cara ukur |
| --- | --- | --- |
| Waktu dari prompt pertama ke GLB pertama | Di bawah 5 menit untuk asset sederhana | Catat waktu pada golden set |
| Asset yang diimpor ke Godot dan Roblox Studio tanpa perbaikan manual | Minimal 90% dari golden set | Tes engine di Phase 5 |
| Jumlah revisi sampai user puas | Dilacak dulu, belum ada target | Hitung prompt revisi per asset |

## Risiko dan Mitigasi

Risiko terbesar adalah asset yang tampak bagus di web tapi rusak di engine; sisanya bisa ditangani lewat rules dan workflow.

| Risiko | Mitigasi |
| --- | --- |
| Asset bagus di web, rusak di engine | Bagian Parity Web dan Game Engine: Preview = Export, Engine Profile, validator, tes engine sungguhan. |
| Prompt ambigu | Agent menyebut interpretasinya secara singkat dan membuat versi awal cepat, karena revisi murah. |
| Revisi merusak bagian yang sudah bagus | Revisi bersifat mengedit, bukan membangun ulang; version history dan undo di Phase 4. |
| Asset organik atau karakter sulit dibuat procedural | Batasan ditulis jelas di PRD; agent memberi tahu saat prompt berada di luar kekuatan pendekatan ini. |
| Dukungan format impor engine berubah | Engine Profile diperbarui dan golden set dijalankan ulang. |
| Hasil tidak konsisten antar revisi | Perbandingan screenshot dan golden set di Phase 5. |

## Pertanyaan Terbuka

Empat hal ini belum diputuskan dan sebaiknya dijawab sebelum atau selama Phase 1.

- [ ] Apakah target engine awal cukup Godot dan Roblox Studio, atau Unity dan Unreal ikut masuk?
- [ ] Apakah GLB bisa langsung diimpor ke Roblox Studio, atau perlu jalur konversi lewat FBX atau OBJ?
- [ ] Apakah satu asset harus menjadi satu mesh, atau boleh terdiri dari beberapa bagian terpisah?
- [ ] Berapa banyak versi per asset yang disimpan untuk undo?
