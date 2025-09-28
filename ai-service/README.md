---
title: Sentimental Chat AI
emoji: 💬
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
license: mit
short_description: Simple sentiment API (Gradio) for case study
---

## SELAMLAR

- **Space URL:** `https://burakkeynz-sentimental-chat-ai.hf.space`

---

## REST için sample 

Direct HTTP POST ile erişmek adına end-point ekledim (502 bad gateaway alıp duruyorudm çünkü), terminalinizden test edebileceğiniz bir curl bıraktım, data kısmındaki "" yi değiştirip test edebilirsiniz.

```bash
curl -s -X POST -H "content-type: application/json" \
  -d '{"data":["bu servis harika!"]}' \
  https://burakkeynz-sentimental-chat-ai.hf.space/predict
