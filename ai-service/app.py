import os
import gradio as gr
from transformers import pipeline

MODEL_ID = os.getenv("HF_MODEL_ID", "cardiffnlp/twitter-xlm-roberta-base-sentiment")
clf = pipeline("sentiment-analysis", model=MODEL_ID)

def analyze(text: str):
    if not text or not text.strip():
        return "NEUTRAL", 0.0, "NEUTRAL"
    out = clf(text[:1000])[0]
    label = str(out["label"]).upper()
    score = float(out["score"])
    mapping = {
        "LABEL_0": "NEGATIVE",
        "LABEL_1": "NEUTRAL",
        "LABEL_2": "POSITIVE",
        "NEG": "NEGATIVE",
        "NEU": "NEUTRAL",
        "POS": "POSITIVE"
    }
    normalized = mapping.get(label, label)
    if normalized not in {"NEGATIVE","NEUTRAL","POSITIVE"}:
        normalized = "NEUTRAL"
    return normalized, score, normalized

demo = gr.Interface(
    fn=analyze,
    inputs=gr.Textbox(lines=3, label="Enter text"),
    outputs=[gr.Text(label="label"), gr.Number(label="score"), gr.Text(label="normalized_label")],
    title="Sentiment API (Gradio)",
    allow_flagging="never"
)

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "7860"))

if __name__ == "__main__":
    demo.queue(False);
    demo.launch(server_name=HOST, server_port=PORT)
