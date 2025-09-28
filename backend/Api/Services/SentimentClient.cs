using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Api.Services
{
    public class SentimentClient
    {
        private readonly HttpClient _http;
        private static readonly JsonSerializerOptions _json = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public SentimentClient(HttpClient http)
        {
            _http = http;
            if (_http.Timeout < TimeSpan.FromSeconds(25))
                _http.Timeout = TimeSpan.FromSeconds(25);
            _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        }

        public async Task<(string label, double score)> AnalyzeAsync(
            string baseUrl, string text, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(text))
                return ("NEUTRAL", 0.0);

            var root = baseUrl.TrimEnd('/');

            // Gradio’da yaygın 3 yolu da test ediyorum, muhtemelen /predict olcak
            var endpoints = new[]
            {
                $"{root}/run/predict",   
                $"{root}/predict",       
                $"{root}/api/predict"    
            };

            var payload = JsonSerializer.Serialize(new { data = new object[] { text[..Math.Min(text.Length, 1000)] } });
            foreach (var url in endpoints)
            {
                try
                {
                    using var resp = await _http.PostAsync(url,
                        new StringContent(payload, Encoding.UTF8, "application/json"), ct);
                    var body = await resp.Content.ReadAsStringAsync(ct);

                    if (!resp.IsSuccessStatusCode) continue;

                    if (TryParse(body, out var label, out var score))
                        return (label, score);
                }
                catch when (!ct.IsCancellationRequested)
                {
                    // network timeouts olursa diye eklenebilir
                }
            }

            throw new Exception("Sentiment service not reachable or returned unexpected schema.");
        }

        // Birden çok şemayı destekle
        private static bool TryParse(string json, out string label, out double score)
        {
            label = "NEUTRAL";
            score = 0.0;

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            JsonElement data;
            if (root.TryGetProperty("data", out data))
            {
                if (data.ValueKind == JsonValueKind.Array && data.GetArrayLength() >= 2
                    && data[0].ValueKind != JsonValueKind.Array)
                {
                    return ReadVec(data, ref label, ref score);
                }

                if (data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0
                    && data[0].ValueKind == JsonValueKind.Array)
                {
                    return ReadVec(data[0], ref label, ref score);
                }

                if (data.ValueKind == JsonValueKind.Object)
                {
                    var ok = false;
                    if (data.TryGetProperty("label", out var l))
                    {
                        label = (l.GetString() ?? "NEUTRAL").ToUpperInvariant();
                        ok = true;
                    }
                    if (data.TryGetProperty("score", out var s) && s.ValueKind == JsonValueKind.Number)
                    {
                        score = s.GetDouble();
                        ok = true;
                    }
                    if (ok) { Normalize(ref label); return true; }
                }
            }

            if (root.ValueKind == JsonValueKind.Array)
            {
                return ReadVec(root, ref label, ref score);
            }

            return false;

            static bool ReadVec(JsonElement vec, ref string label, ref double score)
            {
                if (vec.ValueKind == JsonValueKind.Array && vec.GetArrayLength() >= 2)
                {
                    label = (vec[0].GetString() ?? "NEUTRAL").ToUpperInvariant();
                    score = vec[1].ValueKind == JsonValueKind.Number ? vec[1].GetDouble() : 0.0;
                    Normalize(ref label);
                    return true;
                }
                return false;
            }

            static void Normalize(ref string lab)
            {
                lab = lab switch
                {
                    "LABEL_0" or "NEG" or "NEGATIVE" => "NEGATIVE",
                    "LABEL_1" or "NEU" or "NEUTRAL"  => "NEUTRAL",
                    "LABEL_2" or "POS" or "POSITIVE" => "POSITIVE",
                    _ => "NEUTRAL"
                };
            }
        }
    }
}
