/**
 * afu-cli forku: İngilizce açıklama → Türkçe açıklama sözlüğü.
 *
 * Anahtar, upstream'in kaynak dosyalarındaki açıklama metninin **birebir**
 * kendisidir. Upstream bir açıklamayı değiştirdiğinde eski anahtar eşleşmez ve
 * o satır İngilizce görünür — hangi metinlerin güncellenmesi gerektiğini
 * `/lang missing` listeler. Kaynak dosyalara dokunulmadığı için merge'lerde
 * bu çeviriler çakışma üretmez.
 *
 * Yalnızca açıklamalar çevrilir: komut, bayrak ve alt komut adları İngilizce
 * kalır — kullanıcı onları yazarak çağırır.
 */

export const TR_DESCRIPTIONS: Readonly<Record<string, string>> = {
	// ---------------------------------------------------------------------
	// Alt komutlar (afu <komut>) — cli/command-help.ts
	// ---------------------------------------------------------------------
	"Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio":
		"Oh My Pi'yi stdio üzerinden ACP (Agent Client Protocol) sunucusu olarak çalıştırır",
	"Manage bundled task agents": "Pakete gömülü görev ajanlarını yönetir",
	"Manage the omp auth-broker (credential vault)": "omp auth-broker'ı (kimlik kasası) yönetir",
	"Run an auth-gateway forward proxy backed by the configured broker":
		"Yapılandırılmış broker'a dayanan bir auth-gateway ileri vekil sunucusu çalıştırır",
	"Benchmark models: TTFT/prefill vs decode throughput with p50/p95, across chat, prefill, generation, and prompt-cache workloads":
		"Modelleri kıyaslar: sohbet, ön-doldurma, üretim ve istem-önbelleği yüklerinde p50/p95 ile TTFT/prefill'e karşı çözme verimi",
	"Run the local CDP relay that lets the browser prelude drive your own Chrome tabs":
		"Tarayıcı önsözünün kendi Chrome sekmelerinizi sürmesini sağlayan yerel CDP aktarıcısını çalıştırır",
	"Detect and fix project diagnostics with weighted parallel subagents":
		"Proje tanılarını ağırlıklı paralel alt ajanlarla tespit edip düzeltir",
	"Generate a commit message and update changelogs": "Commit mesajı üretir ve değişiklik günlüklerini günceller",
	"Print a shell completion script (bash, zsh, or fish)": "Kabuk tamamlama betiği yazdırır (bash, zsh veya fish)",
	"Rewrite a text file into the dense prompt register, reporting what it drops":
		"Bir metin dosyasını yoğun istem diline yeniden yazar ve neleri attığını raporlar",
	"Manage configuration settings": "Yapılandırma ayarlarını yönetir",
	"Dry-run OAuth account balancing across random session ids":
		"Rastgele oturum kimlikleri üzerinde OAuth hesap dengelemesini kuru koşu ile dener",
	"Preview tool, composer, and status-line renderers in a deterministic visual gallery":
		"Araç, besteci ve durum satırı çizicilerini belirlenimci bir görsel galeride önizler",
	"Run storage garbage collection": "Depolama çöp toplamayı çalıştırır",
	"Interactive fullscreen git UI: split diff viewer, staging sidebar, and commit composer":
		"Etkileşimli tam ekran git arayüzü: bölünmüş fark görüntüleyici, hazırlama kenar çubuğu ve commit bestecisi",
	"Test grep tool": "grep aracını test eder",
	"View, clean, or push reported tool issues (auto-QA grievances)":
		"Bildirilen araç sorunlarını görüntüler, temizler veya gönderir (otomatik kalite şikâyetleri)",
	"Benchmark instruction following and working memory: one cached thread of glyph array actions with a moving cat-sound directive":
		"Yönerge takibini ve çalışma belleğini kıyaslar: değişen bir kedi-sesi direktifiyle tek önbellekli glif dizisi eylem akışı",
	"Inspect, diagnose, probe, and purge image publication backends":
		"Görsel yayınlama arka uçlarını inceler, tanılar, yoklar ve temizler",
	"Install or link an extension package (alias of `plugin install`/`plugin link`)":
		"Bir eklenti paketini kurar veya bağlar (`plugin install`/`plugin link` eşanlamlısı)",
	"Join a shared collab session (same as /join)": "Paylaşılan ortak çalışma oturumuna katılır (/join ile aynı)",
	"List, search, and refresh available models": "Kullanılabilir modelleri listeler, arar ve tazeler",
	"Manage plugins (install, uninstall, list, etc.)": "Eklentileri yönetir (kurma, kaldırma, listeleme vb.)",
	"List and control daemon-supervised background processes (logs, stop, kill, restart)":
		"Servis tarafından gözetilen arka plan süreçlerini listeler ve yönetir (günlük, durdurma, sonlandırma, yeniden başlatma)",
	"Show what the read tool will return for a path, URL, or internal URI":
		"read aracının bir yol, URL veya dahili URI için ne döndüreceğini gösterir",
	"Draw a session's entire thread through the production transcript pipeline (with repaint timing)":
		"Bir oturumun tüm akışını gerçek döküm hattından geçirerek çizer (yeniden çizim süreleriyle)",
	"Synthesize text with the local TTS engine and play it through the speakers":
		"Metni yerel TTS motoruyla seslendirir ve hoparlörden çalar",
	"Test web search providers": "Web arama sağlayıcılarını test eder",
	"Run onboarding setup or install dependencies for optional features":
		"İlk kurulumu çalıştırır veya isteğe bağlı özelliklerin bağımlılıklarını kurar",
	"Share a saved session via an encrypted link (same as /share)":
		"Kayıtlı bir oturumu şifreli bağlantıyla paylaşır (/share ile aynı)",
	"Interactive shell console": "Etkileşimli kabuk konsolu",
	"Manage SSH host configurations": "SSH sunucu yapılandırmalarını yönetir",
	"View usage statistics": "Kullanım istatistiklerini görüntüler",
	"Download tiny local models (session titles + memory)": "Küçük yerel modelleri indirir (oturum başlıkları + bellek)",
	"Get the API key or OAuth token for a provider": "Bir sağlayıcının API anahtarını veya OAuth jetonunu alır",
	"Inspect and test Time-Traveling Stream Rules (TTSR)": "Zamanda gezen akış kurallarını (TTSR) inceler ve test eder",
	"Check for and install updates": "Güncelleme olup olmadığına bakar ve kurar",
	"Show provider usage limits for every authenticated account":
		"Kimliği doğrulanmış her hesap için sağlayıcı kullanım limitlerini gösterir",
	"Add, list, or clear git worktrees (clone-first when enabled)":
		"git worktree ekler, listeler veya temizler (etkinse önce klonlayarak)",

	// ---------------------------------------------------------------------
	// afu --help: açıklama, argüman ve bayraklar — commands/launch-help.ts
	// ---------------------------------------------------------------------
	"AI coding assistant": "Yapay zekâ kodlama asistanı",
	"Messages to send (prefix files with @)": "Gönderilecek mesajlar (dosyaların başına @ koyun)",
	'Model to use (fuzzy match: "opus", "gpt-5.2", or "openai/gpt-5.2")':
		'Kullanılacak model (esnek eşleşme: "opus", "gpt-5.2" veya "openai/gpt-5.2")',
	"Smol/fast model for lightweight tasks (or PI_SMOL_MODEL env)":
		"Hafif işler için küçük/hızlı model (veya PI_SMOL_MODEL ortam değişkeni)",
	"Slow/reasoning model for thorough analysis (or PI_SLOW_MODEL env)":
		"Derin analiz için yavaş/akıl yürüten model (veya PI_SLOW_MODEL ortam değişkeni)",
	"Plan model for architectural planning (or PI_PLAN_MODEL env)":
		"Mimari planlama için plan modeli (veya PI_PLAN_MODEL ortam değişkeni)",
	"Switch from the active model to a fast/cheap model at the first edit/write after the plan's todo list exists (default off; see prewalk.enabled)":
		"Planın yapılacaklar listesi oluştuktan sonraki ilk düzenleme/yazma işleminde etkin modelden hızlı/ucuz modele geçer (varsayılan kapalı; bkz. prewalk.enabled)",
	"Disable prewalk even if prewalk.enabled is set": "prewalk.enabled açık olsa bile prewalk'ı devre dışı bırakır",
	'Target model for prewalk (default the "smol" role)': 'prewalk için hedef model (varsayılan "smol" rolü)',
	"Force read-only plan mode at start, auto-approve the plan on the model's first resolve call, then switch to --plan-yolo-into to implement it":
		"Başlangıçta salt-okur plan kipini zorlar, modelin ilk resolve çağrısında planı otomatik onaylar, ardından uygulamak için --plan-yolo-into modeline geçer",
	'Target model for plan-yolo execution (default the "smol" role)':
		'plan-yolo yürütmesi için hedef model (varsayılan "smol" rolü)',
	"Provider to use (legacy; prefer --model)": "Kullanılacak sağlayıcı (eski yöntem; --model tercih edin)",
	"API key (defaults to env vars)": "API anahtarı (varsayılan olarak ortam değişkenlerinden)",
	"System prompt (default: coding assistant prompt)": "Sistem istemi (varsayılan: kodlama asistanı istemi)",
	"Append text or file contents to the system prompt": "Sistem istemine metin veya dosya içeriği ekler",
	"Allow starting in ~ without auto-switching to a temp dir":
		"Geçici dizine otomatik geçmeden ~ içinde başlamaya izin verir",
	"Use an isolated profile for auth, sessions, settings, and caches":
		"Kimlik, oturum, ayar ve önbellekler için yalıtılmış bir profil kullanır",
	"Create a shell shortcut for the selected profile and exit": "Seçili profil için kabuk kısayolu oluşturur ve çıkar",
	"Directory to start in (overrides the launch cwd)": "Başlanacak dizin (başlatma çalışma dizinini geçersiz kılar)",
	"Output mode: text (default), json, rpc, or rpc-ui": "Çıktı kipi: text (varsayılan), json, rpc veya rpc-ui",
	"Load an extra config.yml-style overlay for this run (repeatable)":
		"Bu çalıştırma için ek bir config.yml katmanı yükler (birden çok kez verilebilir)",
	"Add a workspace directory beyond the working directory (repeatable)":
		"Çalışma dizinine ek bir çalışma alanı dizini ekler (birden çok kez verilebilir)",
	"Non-interactive mode: process prompt and exit": "Etkileşimsiz kip: istemi işler ve çıkar",
	"Continue previous session": "Önceki oturuma devam eder",
	"Resume a session (by ID prefix, path, or picker if omitted)":
		"Bir oturumu sürdürür (kimlik ön eki, yol ile; verilmezse seçiciyle)",
	"Import a Claude Code session into OMP": "Bir Claude Code oturumunu OMP'ye aktarır",
	"Import a Codex session into OMP": "Bir Codex oturumunu OMP'ye aktarır",
	"Directory for session storage and lookup": "Oturumların saklandığı ve arandığı dizin",
	"Don't save session (ephemeral)": "Oturumu kaydetmez (geçici)",
	"Comma-separated model patterns for Ctrl+P cycling": "Ctrl+P ile geçiş için virgülle ayrılmış model desenleri",
	"Disable all built-in tools": "Yerleşik araçların tümünü devre dışı bırakır",
	"Disable LSP tools, formatting, and diagnostics": "LSP araçlarını, biçimlendirmeyi ve tanılamayı devre dışı bırakır",
	"Disable PTY-based interactive bash execution": "PTY tabanlı etkileşimli bash çalıştırmayı devre dışı bırakır",
	"Comma-separated list of tools to enable (default: all)":
		"Etkinleştirilecek araçların virgülle ayrılmış listesi (varsayılan: tümü)",
	"Set thinking level: off, minimal, low, medium, high, xhigh, max, auto":
		"Düşünme seviyesini ayarlar: off, minimal, low, medium, high, xhigh, max, auto",
	"OpenAI service tier for this session (none omits service_tier)":
		"Bu oturum için OpenAI hizmet katmanı (none, service_tier'ı hiç göndermez)",
	"Hide thinking blocks in TUI output (display only, does not disable model thinking)":
		"Düşünme bloklarını arayüzde gizler (yalnızca görüntü; modelin düşünmesini kapatmaz)",
	"Enable the advisor runtime (passively reviews each turn and injects notes)":
		"Danışman çalışma zamanını açar (her turu edilgen biçimde inceler ve not ekler)",
	"Use a private scratchpad while disabling supported GPT, Claude, and Gemini reasoning (at your own risk: providers have flagged this request shape as abuse)":
		"Desteklenen GPT, Claude ve Gemini akıl yürütmesini kapatıp özel bir karalama alanı kullanır (riski size ait: sağlayıcılar bu istek biçimini kötüye kullanım olarak işaretledi)",
	"Load a hook/extension file (can be used multiple times)":
		"Bir kanca/eklenti dosyası yükler (birden çok kez kullanılabilir)",
	"Load an extension file (can be used multiple times)": "Bir eklenti dosyası yükler (birden çok kez kullanılabilir)",
	"Disable extension discovery (explicit -e paths still work)":
		"Eklenti keşfini kapatır (açıkça verilen -e yolları yine çalışır)",
	"Disable skills discovery and loading": "Beceri keşfini ve yüklenmesini kapatır",
	"Comma-separated glob patterns to filter skills (e.g., git-*,docker)":
		"Becerileri süzmek için virgülle ayrılmış glob desenleri (ör. git-*,docker)",
	"Disable rules discovery and loading": "Kural keşfini ve yüklenmesini kapatır",
	"Export session file to HTML and exit": "Oturum dosyasını HTML'e aktarır ve çıkar",
	"Disable title auto-generation": "Başlığın otomatik üretilmesini kapatır",
	"Include thinking blocks in print mode text output": "Yazdırma kipi metin çıktısına düşünme bloklarını da katar",
	"Stop the session after this duration (e.g., 600, 10m, 1h)": "Oturumu bu süre sonunda durdurur (ör. 600, 10m, 1h)",
	"Auto-approve all tool calls (skip approval prompts)":
		"Tüm araç çağrılarını otomatik onaylar (onay sorularını atlar)",
	"Override tools.approvalMode for this session (always-ask|write|yolo)":
		"Bu oturum için tools.approvalMode ayarını geçersiz kılar (always-ask|write|yolo)",

	// ---------------------------------------------------------------------
	// Slash komutları — slash-commands/builtin-*.ts
	// ---------------------------------------------------------------------
	"Plan, run, inspect, import, and compare OMP-native security scans":
		"OMP-yerel güvenlik taramalarını planlar, çalıştırır, inceler, içe aktarır ve karşılaştırır",
	"Open settings menu": "Ayarlar menüsünü açar",
	"Open provider setup": "Sağlayıcı kurulumunu açar",
	"Toggle plan mode (agent plans before executing)": "Plan kipini açar/kapatır (ajan uygulamadan önce plan yapar)",
	"Re-open the plan review for the latest plan (plan mode only)":
		"Son planın incelemesini yeniden açar (yalnızca plan kipinde)",
	"Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)":
		"Vibe kipini açar/kapatır (doğrudan kalıcı hızlı/iyi işçi oturumları; salt-okur araç seti)",
	"Toggle goal mode (persistent autonomous objective for this session)":
		"Hedef kipini açar/kapatır (bu oturum için kalıcı özerk amaç)",
	"Have the agent interview you in chat, then set up goal mode":
		"Ajanın sohbette sizinle görüşmesini sağlar, ardından hedef kipini kurar",
	"Toggle loop mode. While enabled, the next prompt you send re-submits after every yield. Esc cancels the current iteration; /loop again to disable.":
		"Döngü kipini açar/kapatır. Açıkken gönderdiğiniz istem her duraklamadan sonra yeniden gönderilir. Esc geçerli turu iptal eder; kapatmak için yine /loop.",
	"Queue a message for after the agent yields": "Ajan durakladıktan sonrası için mesaj kuyruğa alır",
	"Switch model for this session": "Bu oturumun modelini değiştirir",
	"Switch model for this session (same as alt+p); accepts fuzzy ids, provider/id, @role, :level":
		"Bu oturumun modelini değiştirir (alt+p ile aynı); esnek kimlik, sağlayıcı/kimlik, @rol, :seviye kabul eder",
	"Toggle priority service tier (OpenAI service_tier=priority, Anthropic speed=fast)":
		"Öncelikli hizmet katmanını açar/kapatır (OpenAI service_tier=priority, Anthropic speed=fast)",
	"Toggle listing available skills in the system prompt (session only)":
		"Kullanılabilir becerilerin sistem isteminde listelenmesini açar/kapatır (yalnızca bu oturum)",
	"Toggle extended context windows": "Genişletilmiş bağlam pencerelerini açar/kapatır",
	"Toggle the native computer-use eval prelude for this session":
		"Bu oturum için yerel bilgisayar kullanımı önsözünü açar/kapatır",
	"Switch to a fast/cheap model at the next action (works even without --prewalk)":
		"Bir sonraki eylemde hızlı/ucuz modele geçer (--prewalk olmadan da çalışır)",
	"Toggle the advisor (a second model that reviews each turn and injects notes)":
		"Danışmanı açar/kapatır (her turu inceleyip not ekleyen ikinci bir model)",
	"Export session to HTML file": "Oturumu HTML dosyasına aktarır",
	"Open this session's trace in the stats dashboard": "Bu oturumun izini istatistik panosunda açar",
	"Copy session transcript to clipboard (and write LLM request JSON to tmp)":
		"Oturum dökümünü panoya kopyalar (ve LLM istek JSON'unu geçici dizine yazar)",
	"Share session via an encrypted link (share server or secret gist)":
		"Oturumu şifreli bağlantıyla paylaşır (paylaşım sunucusu veya gizli gist)",
	"Share this session live via a relay": "Bu oturumu bir aktarıcı üzerinden canlı paylaşır",
	"Join a shared collab session": "Paylaşılan ortak çalışma oturumuna katılır",
	"Leave the collab session": "Ortak çalışma oturumundan ayrılır",
	"Toggle browser eval-prelude headless vs visible mode": "Tarayıcı önsözünü başsız/görünür kip arasında değiştirir",
	"Pick text or code from the conversation to copy": "Konuşmadan kopyalanacak metni veya kodu seçer",
	"Open the last link from the conversation in your browser (or pick one with /copy)":
		"Konuşmadaki son bağlantıyı tarayıcıda açar (veya /copy ile seçin)",
	"View or modify the agent's todo list": "Ajanın yapılacaklar listesini görüntüler veya değiştirir",
	"Session management commands": "Oturum yönetimi komutları",
	"Show async background jobs status": "Eşzamansız arka plan işlerinin durumunu gösterir",
	"Show provider usage and limits": "Sağlayıcı kullanımını ve limitlerini gösterir",
	"Launch the local stats dashboard": "Yerel istatistik panosunu başlatır",
	"Show changelog entries": "Değişiklik günlüğü kayıtlarını gösterir",
	"Show all keyboard shortcuts": "Tüm klavye kısayollarını gösterir",
	"Show tools currently visible to the agent": "Ajanın şu an gördüğü araçları gösterir",
	"Show estimated context usage breakdown": "Tahmini bağlam kullanımının dökümünü gösterir",
	"Open Extension Control Center dashboard": "Eklenti Kontrol Merkezi panosunu açar",
	"Open the agents hub (per-agent model, prewalk, and advisor)":
		"Ajan merkezini açar (ajan başına model, prewalk ve danışman)",
	"Open the git UI (split diff viewer, staging, commit composer)":
		"git arayüzünü açar (bölünmüş fark görüntüleyici, hazırlama, commit bestecisi)",
	"Open the live Agent Hub": "Canlı Ajan Merkezini açar",
	"Rewind to a previous message, keeping the old path as a branch":
		"Önceki bir mesaja geri sarar, eski yolu dal olarak saklar",
	"Create a new fork from a previous message": "Önceki bir mesajdan yeni bir çatal oluşturur",
	"Navigate session tree (switch branches)": "Oturum ağacında gezinir (dallar arası geçiş)",
	"Login with OAuth provider": "OAuth sağlayıcısıyla giriş yapar",
	"Logout from OAuth provider": "OAuth sağlayıcısından çıkış yapar",
	"Manage MCP servers (add, list, remove, test)": "MCP sunucularını yönetir (ekleme, listeleme, kaldırma, test)",
	"Manage SSH hosts (add, list, remove)": "SSH sunucularını yönetir (ekleme, listeleme, kaldırma)",
	"Start a new session": "Yeni bir oturum başlatır",
	"Reset provider stream state without changing the local transcript":
		"Yerel dökümü değiştirmeden sağlayıcı akış durumunu sıfırlar",
	"Clear the conversation context in place, keeping the session":
		"Oturumu koruyarak konuşma bağlamını yerinde temizler",
	"Delete the current session and start a new one": "Geçerli oturumu siler ve yenisini başlatır",
	"Manually compact the session context": "Oturum bağlamını elle sıkıştırır",
	"Drop heavy content from context (tool results, large blocks)":
		"Ağır içeriği bağlamdan atar (araç sonuçları, büyük bloklar)",
	"Hand off session context to a new session": "Oturum bağlamını yeni bir oturuma devreder",
	"Resume a different session": "Farklı bir oturumu sürdürür",
	"Pin or unpin a session at the top of the resume list":
		"Bir oturumu sürdürme listesinin başına sabitler veya sabitlemeyi kaldırır",
	"Ask an ephemeral side question using the current session context":
		"Geçerli oturum bağlamını kullanarak geçici bir yan soru sorar",
	"Run a full background agent on tangential work": "Yan bir iş için tam yetkili arka plan ajanı çalıştırır",
	"Forge a TTSR rule from a complaint to stop a recurring behavior":
		"Yinelenen bir davranışı durdurmak için şikâyetten TTSR kuralı üretir",
	"Retry the last failed agent turn": "Başarısız olan son ajan turunu yeniden dener",
	"Open debug tools selector": "Hata ayıklama araçları seçicisini açar",
	"Inspect and operate memory maintenance": "Bellek bakımını inceler ve yürütür",
	"Rename the current session": "Geçerli oturumu yeniden adlandırır",
	"Move the current session to a different directory": "Geçerli oturumu başka bir dizine taşır",
	"Move this session into a new worktree, changes included":
		"Bu oturumu değişiklikleriyle birlikte yeni bir worktree'ye taşır",
	"Add a workspace directory to this session (multi-root)": "Bu oturuma çalışma alanı dizini ekler (çok köklü)",
	"Remove a workspace directory from this session": "Bu oturumdan bir çalışma alanı dizinini kaldırır",
	"List this session's workspace directories": "Bu oturumun çalışma alanı dizinlerini listeler",
	"Exit the application": "Uygulamadan çıkar",
	"Restart omp with the same launch flags, resuming this session":
		"Aynı başlatma bayraklarıyla yeniden başlatır ve bu oturumu sürdürür",
	"Manage marketplace plugin sources and installed plugins":
		"Mağaza eklenti kaynaklarını ve kurulu eklentileri yönetir",
	"View and manage installed plugins": "Kurulu eklentileri görüntüler ve yönetir",
	"Reload all plugins (skills, commands, hooks, tools, agents, MCP)":
		"Tüm eklentileri yeniden yükler (beceriler, komutlar, kancalar, araçlar, ajanlar, MCP)",
	"Force next turn to use a specific tool": "Sonraki turda belirli bir aracın kullanılmasını zorlar",
	"Start Codex-backed realtime voice mode": "Codex destekli gerçek zamanlı ses kipini başlatır",
	"Freeze all agents (main, subagents, advisor) until resumed":
		"Tüm ajanları (ana, alt ajanlar, danışman) sürdürülene dek dondurur",
	"Quit the application": "Uygulamadan çıkar",
	"Check for and install afu updates": "afu güncellemesi olup olmadığına bakar ve kurar",
	"Switch the language of interface descriptions (Turkish / English)":
		"Arayüz açıklamalarının dilini değiştirir (Türkçe / English)",
	"Show descriptions in Turkish": "Açıklamaları Türkçe göster",
	"Show descriptions in English (upstream wording)": "Açıklamaları İngilizce (upstream metni) göster",
	"Show the active language and translation count": "Etkin dili ve çeviri sayısını göster",
	"List descriptions that have no translation yet": "Henüz çevirisi olmayan açıklamaları listele",

	// ---------------------------------------------------------------------
	// Slash alt komutları
	// ---------------------------------------------------------------------
	"Create an immutable security scan plan": "Değiştirilemez bir güvenlik tarama planı oluşturur",
	"Start a planned or newly planned native scan": "Planlanmış ya da yeni planlanan yerel taramayı başlatır",
	"Show native scan operation status": "Yerel tarama işleminin durumunu gösterir",
	"Cancel a running native scan": "Çalışan yerel taramayı iptal eder",
	"List stored project security scans": "Saklanan proje güvenlik taramalarını listeler",
	"Render a scan or security:// resource": "Bir taramayı veya security:// kaynağını görüntüler",
	"Import SARIF or a Codex Security bundle": "SARIF veya Codex Security paketi içe aktarır",
	"Export a canonical bundle, SARIF, or report": "Standart paket, SARIF veya rapor dışa aktarır",
	"Validate one finding with OMP-native tools": "Tek bir bulguyu OMP-yerel araçlarla doğrular",
	"Compare finding lineage across two scans": "İki tarama arasında bulgu soyunu karşılaştırır",
	"Set a finding disposition with rationale": "Bir bulguya gerekçesiyle birlikte karar atar",
	"Configure sign-in and web search providers": "Giriş ve web arama sağlayıcılarını yapılandırır",
	"Set or replace the goal": "Hedefi belirler veya değiştirir",
	"Show current goal details": "Geçerli hedefin ayrıntılarını gösterir",
	"Pause the current goal": "Geçerli hedefi duraklatır",
	"Resume a paused goal": "Duraklatılmış hedefi sürdürür",
	"Drop the current goal": "Geçerli hedefi bırakır",
	"Adjust the token budget": "Jeton bütçesini ayarlar",
	"Enable fast mode": "Hızlı kipi açar",
	"Disable fast mode": "Hızlı kipi kapatır",
	"Show fast mode status": "Hızlı kip durumunu gösterir",
	"List skills in the prompt for this session": "Bu oturumda becerileri sistem isteminde listeler",
	"Omit the skills listing for this session": "Bu oturumda beceri listesini eklemez",
	"Show skill listing status": "Beceri listeleme durumunu gösterir",
	"Enable larger context windows": "Daha büyük bağlam pencerelerini açar",
	"Use default or standard-pricing context windows": "Varsayılan ya da standart fiyatlı bağlam pencerelerini kullanır",
	"Show extended context status": "Genişletilmiş bağlam durumunu gösterir",
	"Enable computer use for this session": "Bu oturum için bilgisayar kullanımını açar",
	"Disable computer use for this session": "Bu oturum için bilgisayar kullanımını kapatır",
	"Show computer use status": "Bilgisayar kullanımı durumunu gösterir",
	"Enable the advisor": "Danışmanı açar",
	"Disable the advisor": "Danışmanı kapatır",
	"Show advisor status": "Danışman durumunu gösterir",
	"Copy the advisor's transcript to clipboard": "Danışmanın dökümünü panoya kopyalar",
	"Open the advisor configuration editor (TUI)": "Danışman yapılandırma düzenleyicisini açar (TUI)",
	"Share a read-only link (guests can watch, not prompt)":
		"Salt-okur bağlantı paylaşır (konuklar izler, istem gönderemez)",
	"Show link + participants": "Bağlantıyı ve katılımcıları gösterir",
	"Stop sharing": "Paylaşımı durdurur",
	"Switch to headless mode": "Başsız kipe geçer",
	"Switch to visible mode": "Görünür kipe geçer",
	"Open todos in $EDITOR (Markdown round-trip)": "Yapılacakları $EDITOR ile açar (Markdown gidiş-dönüş)",
	"Copy todos as Markdown to clipboard": "Yapılacakları Markdown olarak panoya kopyalar",
	"Show every phase and task in the HUD": "Tüm aşama ve görevleri göstergede gösterir",
	"Restore the bounded HUD preview": "Sınırlı gösterge önizlemesine döner",
	"Write todos as Markdown to a file (default: TODO.md)":
		"Yapılacakları Markdown olarak dosyaya yazar (varsayılan: TODO.md)",
	"Replace todos from a Markdown file (default: TODO.md)":
		"Yapılacakları bir Markdown dosyasından değiştirir (varsayılan: TODO.md)",
	"Append a task; phase fuzzy-matched or auto-created": "Görev ekler; aşama esnek eşleşir veya otomatik oluşturulur",
	"Mark task in_progress (fuzzy-matched)": "Görevi in_progress olarak işaretler (esnek eşleşme)",
	"Mark task/phase/all completed (fuzzy-matched)": "Görevi/aşamayı/tümünü tamamlandı olarak işaretler (esnek eşleşme)",
	"Mark task/phase/all abandoned (fuzzy-matched)": "Görevi/aşamayı/tümünü bırakıldı olarak işaretler (esnek eşleşme)",
	"Remove task/phase/all (fuzzy-matched)": "Görevi/aşamayı/tümünü kaldırır (esnek eşleşme)",
	"Show session info and stats": "Oturum bilgilerini ve istatistiklerini gösterir",
	"Delete current session and return to selector": "Geçerli oturumu siler ve seçiciye döner",
	"Pin the current provider to a stored OAuth account": "Geçerli sağlayıcıyı kayıtlı bir OAuth hesabına sabitler",
	"Spend a saved Codex rate-limit reset": "Saklanan bir Codex limit sıfırlamasını kullanır",
	"Show complete changelog": "Değişiklik günlüğünün tamamını gösterir",
	"Add a new MCP server": "Yeni bir MCP sunucusu ekler",
	"List all configured MCP servers": "Tanımlı tüm MCP sunucularını listeler",
	"Remove an MCP server": "Bir MCP sunucusunu kaldırır",
	"Test connection to a server": "Bir sunucuya bağlantıyı test eder",
	"Reauthorize OAuth for a server": "Bir sunucu için OAuth yetkisini yeniler",
	"Remove OAuth auth from a server": "Bir sunucudan OAuth yetkisini kaldırır",
	"Enable an MCP server": "Bir MCP sunucusunu etkinleştirir",
	"Disable an MCP server": "Bir MCP sunucusunu devre dışı bırakır",
	"Search Smithery registry and deploy an MCP server": "Smithery kayıt defterinde arar ve MCP sunucusu yayına alır",
	"Login to Smithery and cache API key": "Smithery'ye giriş yapar ve API anahtarını önbelleğe alır",
	"Remove cached Smithery API key": "Önbellekteki Smithery API anahtarını siler",
	"Reconnect to a specific MCP server": "Belirli bir MCP sunucusuna yeniden bağlanır",
	"Force reload MCP runtime tools": "MCP çalışma zamanı araçlarını yeniden yüklemeye zorlar",
	"List available resources from connected servers": "Bağlı sunucuların sunduğu kaynakları listeler",
	"List available prompts from connected servers": "Bağlı sunucuların sunduğu istemleri listeler",
	"Show notification capabilities and subscriptions": "Bildirim yeteneklerini ve abonelikleri gösterir",
	"Show help message": "Yardım mesajını gösterir",
	"Add an SSH host": "SSH sunucusu ekler",
	"List all configured SSH hosts": "Tanımlı tüm SSH sunucularını listeler",
	"Remove an SSH host": "Bir SSH sunucusunu kaldırır",
	"Summarize locally with the active model (skip server compaction)":
		"Etkin modelle yerelde özetler (sunucu sıkıştırmasını atlar)",
	"Summarize via OpenAI-compatible server compaction, then fall back to a local summary":
		"OpenAI uyumlu sunucu sıkıştırmasıyla özetler, olmazsa yerel özete düşer",
	"Archive history onto dense bitmap images the model reads back (no LLM call)":
		"Geçmişi modelin geri okuduğu yoğun bit eşlem görsellerine arşivler (LLM çağrısı yok)",
	"Strip tool results + large blocks (default)": "Araç sonuçlarını ve büyük blokları çıkarır (varsayılan)",
	"Strip image blocks": "Görsel bloklarını çıkarır",
	"Drop all thinking blocks": "Tüm düşünme bloklarını atar",
	"Show current memory injection payload": "Belleğe eklenen güncel yükü gösterir",
	"Show memory backend statistics": "Bellek arka ucu istatistiklerini gösterir",
	"Run memory backend diagnostics": "Bellek arka ucu tanılamasını çalıştırır",
	"Show pending memory deltas awaiting consolidation": "Birleştirmeyi bekleyen bellek değişikliklerini gösterir",
	"Run memory consolidation now": "Bellek birleştirmesini şimdi çalıştırır",
	"Clear persisted memory data and artifacts": "Kalıcı bellek verilerini ve çıktılarını temizler",
	"Alias for clear": "clear için eşanlamlı",
	"Enqueue memory consolidation maintenance": "Bellek birleştirme bakımını kuyruğa alır",
	"Alias for enqueue": "enqueue için eşanlamlı",
	"List mental models on the active bank": "Etkin bankadaki zihinsel modelleri listeler",
	"Show one mental model (id required)": "Tek bir zihinsel modeli gösterir (kimlik gerekir)",
	"Refresh auto-refresh models bank-wide, or one model by id":
		"Otomatik tazelenen modelleri banka genelinde ya da kimliğiyle tek tek tazeler",
	"Diff the change history of a mental model": "Bir zihinsel modelin değişiklik geçmişinin farkını alır",
	"Create any built-in mental models that are missing": "Eksik olan yerleşik zihinsel modelleri oluşturur",
	"Delete a mental model from the bank (id required)": "Bankadan bir zihinsel modeli siler (kimlik gerekir)",
	"Re-pull the cached <mental_models> block": "Önbellekteki <mental_models> bloğunu yeniden çeker",
	"Add a marketplace source": "Mağaza kaynağı ekler",
	"Remove a marketplace source": "Mağaza kaynağını kaldırır",
	"Update marketplace catalog(s)": "Mağaza kataloglarını günceller",
	"List configured marketplaces": "Tanımlı mağazaları listeler",
	"Browse available plugins": "Kullanılabilir eklentilere göz atar",
	"Install a plugin (interactive browser if no args)": "Bir eklenti kurar (argüman verilmezse etkileşimli tarayıcı)",
	"Uninstall a plugin (selector if no args)": "Bir eklentiyi kaldırır (argüman verilmezse seçici)",
	"List installed marketplace plugins": "Kurulu mağaza eklentilerini listeler",
	"Upgrade outdated plugins": "Güncelliğini yitirmiş eklentileri yükseltir",
	"Show usage guide": "Kullanım kılavuzunu gösterir",
	"List all installed plugins (npm + marketplace)": "Kurulu tüm eklentileri listeler (npm + mağaza)",
	"Enable a marketplace plugin": "Bir mağaza eklentisini etkinleştirir",
	"Disable a marketplace plugin": "Bir mağaza eklentisini devre dışı bırakır",
};
