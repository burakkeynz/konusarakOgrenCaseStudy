# Backend (.NET 8) – Konuşarak Öğren Case Study

## Kullanılan Teknolojiler

- .NET 8 (ASP.NET Core Web API)
- (İsteğe bağlı) SignalR – gerçek zamanlı mesaj/analiz yayını
- SQLite (diskte kaydettiğim için ilk açtığınızda herhangi bir data olmayacak)
- HTTP Client – HF Spaces / Gradio endpoint entegrasyonu
- CORS, DI, Middleware

## Canlı Linkler

-Canlı linkleri mailden sizlere iletiyor olacağım.

## Çalıştırma (Lokal)

```bash
cd backend
dotnet restore
# .env oluşturun (aşağıdaki örneğe göre)
dotnet run
```

## .env.example

```bash
ASPNETCORE_ENVIRONMENT=Development
AI_BASE_URL=https://<your-space>.hf.space
CORS_ORIGINS=https://<your-vercel-app>.vercel.app, http://localhost:5173, http://localhost:3000

```
