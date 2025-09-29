# Konuşarak Öğren – Full-Stack + AI Case Study

Bu repo Konuşarak Öğren Full Stack + AI Case Study adına oluşturulmuştur. Kök rootta API ların görevleri hakkında + Frontend ve HF Space hakkında bilgilendirilme verilecektir, aynı zamanda backend frontend ve ai-service içinde README.md koyabilirim

---

## Technologies Used

**Backend:** ASP.NET Core Web API  
**Frontend:** React  
**Database:** SQLİte
**Authentication:** Basit bir Alias girişi
**UI Design:** CSS
**GDevelopment Environment:** Docker (Render deploy için)

---

## User Rolleri and Yapabilecekleri

**Kullanıcılar**
-Alias isim yazılarak giriş yapabilir, başka kişilerle chatleşebilir.Chatleşirken yazmış olduğu ve karşıdan gelen mesajlarının olumlu, olumsuz veya nötr olup olmadığını AI analiziyle görebilir. Daha önce bi sohbet olusturmamıssa bunu olusturabilir. Daha önce o kişiden gelen mesajları okumamışsa bunu badge ile birlikte görebilir.

> Not: Burdaki Authentication oldukça basit bırakılmıştır (istenen üzerine sadece rümuz-alias ile giriş vardır), gerçek bir appte HTTP-Cookie bazlı Session ile kaydedilmelidir, aliaslar localStorage ile basitçe tutulmuştur (JWT amaçlı, süresiz, çıkış yap diyince çıkış olan)

---

## Setup Gereksinimleri

**.NET 8 SDK**
**Node.js 18+ ve npm**
**Opsiyonel olarak Docker (Render için bana şart oldu veya MsSQL kullanacaksanız)**
**React CRA (create-react-app)**
**Python3 veya Python**
**Gradio API-Hugging Face Spaces**

---

## Backend tarafı classlar ve API dökümantasyonu

**Apı/Program.cs**
-Programın runlandığı yer, API’nin tüm yaşam döngüsünü kurar (konfig + DI + CORS + DB migrate), tüm HTTP endpointlerini ve SignalR hubını mapler, mesaj oluşturma akışında AI analizi ve realtime yayını koordine eder.
**Endpointler**

-GET /health -->Program çalışıyor mu kontrolü
-POST /auth/alias --> Basit rumuz ile auth
-GET /users -->id ve alias listesini çeker

- DELETE /admin/messages -->iki taraflı tüm mesajları siler, normalde auth bazlı kişi bazlı silme yapılmaı.
- POST /messages -->thread akış: istek doğrulama ve kullanıcı alıcının varlığının kontrolü + SentimentClient ile AI analizi + mesaj DB'ye Ready kaydetme, SignalIR ile publish, thread kısmına "message", inbux kısmına "inbox:new" şeklinde ve kayıtlı messageresponse döner
  -GET/messages -->Kullanıcının dahil oldugu son x mesaj
  -GET /messages/thread --> İki kullanıcı arasındaki mesajların kronolijik sıralamsı
  -GET /inbox/unread --> okunmamış mesajların peer bazında sayısı
  -POST /messages/mark-read --> Okundu kısmı, toplam unread'i de "inbox:unread" kısmına publishleme
  > Not: Sentiment servisi ulaşılamazsa 502 status ile anlamlı hata mesajı döndürüyor, basitçe alert koydum React'in toastify'ını kullanmak istemedim (çok fazla npm install oldu)

**Api/Data/AppDbContext.cs**
-Kullanıcı mesaj ilişkilerini net kurar, benzersiz alias kuralını uygular, inbox-unread sorgularını optimize eder ve durum bilgisini güvenli/okunur şekilde saklar. Bu sınıf, uygulamanın veri katmanının merkezi.

**Api/Dtos**
-DTO (Data Transfer Object) kayıtları; HTTP istek/yanıt gövdelerinin şemasını tanımlar.
-Records (immutable) kullanımı, DTO’ları sade ve güvenilir tutar.

- **Api/Hubs**
  -Gerçek-zamanlı mesajlaşma için SignalR hubı
  -UserKey(userId) → "u:{id}": Kullanıcıya ait inbox yayınları.
  -ThreadKey(a,b) → "t:{small}:{big}": İki kullanıcı arasındaki sohbet grubu.
  -...
  **Api/Models**
  -Veri katmanında üç temel model var. User benzersiz Alias alanıyla kullanıcıyı temsil eder; Message ise gönderici/alıcı ilişkileri (sender cascade, receiver restrict), metin içeriği, duygu analizi (SentimentLabel/Score) ve okunma takibini (IsRead/ReadAt) tutar. MessageStatus (PENDING/READY/FAILED) mesajın işlenme durumunu belirtir ve süreç-teşhis için hızlı görünürlük sağlar.

  **Api/Services/SentimentClient.cs**:
  -SentimentClient: HF Spaces/Gradio duygu analizi servisine HttpClient ile istek atar, yanıtı parse edip standart bir çift olarak döner: (label, score). /run/predict, /predict ve /api/predict gibi yaygın uçları otomatik dener; farklı JSON şemalarını (array, array-içinde-array, object {label,score}) toleranslı biçimde çözümler ve etiketi NEGATIVE/NEUTRAL/POSITIVE olarak normalize eder. Boş metin için ("NEUTRAL", 0.0) döner; servis ulaşılamazsa anlamlı bir istisna fırlatır (Program.cs bu durumda 502 döndürür).

---

## Frontend tarafı

**Kurulum**
cd frontend
cp .env.example .env
npm i
npm start

**İlgili paketler package.jsondan çekilmeli**

**Akış**
-Uygulama, kullanıcıyı basit bir alias ile girişe alır ve localStorage’da userId/alias tutar. Girişten sonra /users, /messages, /messages/thread ve /inbox/unread uçlarını çağırarak sol sohbet listesi, aktif thread ve okunmamış rozetlerini yönetir. SignalR ile /hubs/chat’e bağlanır; "message" ve "inbox:new" olaylarıyla gerçek zamanlı yeni mesajları alır, aktif konuşmadaysa mesaja ekler, değilse unread sayacını artırır. Kullanıcı thread değiştirince hub’da JoinThread/LeaveThread çağrıları yapılır, geçmiş mesajlar yüklenir ve /messages/mark-read ile rozetler sıfırlanır. Mesaj gönderimi POST /messages ile yapılır; sentiment etiketi/puanı yanıtla gelir ve UI’da balon altında gösterilir.

---

## AI-service tarafı

```
torch==2.6.0
transformers==4.44.2
gradio==4.44.0
safetensors==0.4.3
numpy==1.26.4
huggingface-hub>=0.23
```

-bu dosyalar minmum gerekenlerdir, basitçe HF'deki cardiffnlp/twitter-xlm-roberta-base-sentiment kullanılarak app.py scripti yazılmış ve burda sentimental analizi olusuturulmustur

---

## Mobile tarafı

-Mobile tarafı adına çalıştığım dosyaları atıyorum, burada React-Native-CLI ile frontendteki kodların aynısının sadece React-Native tarafı yazılmıştır, npx create komutlarıyla test edilmiş run-ios ve run-andorid yapılmıştır

> Not: Aşağı yukarı çoğu kısım detaylı-orta detaylı şekilde açıklanmıstır. Kodlar içinde + olarak // lar ekleyerek bunu daha açıklamaya çalıştım, mobile tarafı için ss lerle birlikte test edilebilecek klasörü atıyorum.
> Not: mobile kurulumda Xcode ve javanın gradle ını kullandım, + olaraktan emülatörlerle test ettim ve Metro ile ayağa kaldırdım projeyi, başka bir terminalden iosları runladım
