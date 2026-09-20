import json,os,sys,wave
from vosk import Model,KaldiRecognizer

audio=sys.argv[1]
model_dir=os.environ.get("VOSK_MODEL_DIR","/opt/vosk-model")
if not os.path.isdir(model_dir):
    raise SystemExit("Vosk model not found: "+model_dir)

with wave.open(audio,"rb") as wf:
    if wf.getnchannels()!=1 or wf.getsampwidth()!=2 or wf.getframerate()!=16000:
        raise SystemExit("Audio must be mono 16-bit PCM at 16kHz")
    rec=KaldiRecognizer(Model(model_dir),wf.getframerate())
    rec.SetWords(True)
    segments=[]
    while True:
        data=wf.readframes(4000)
        if not data: break
        if rec.AcceptWaveform(data):
            r=json.loads(rec.Result())
            words=r.get("result") or []
            if words:
                text=" ".join(w.get("word","") for w in words).strip()
                segments.append({"start":float(words[0]["start"]),"end":float(words[-1]["end"]),"text":text})
    r=json.loads(rec.FinalResult())
    words=r.get("result") or []
    if words:
        text=" ".join(w.get("word","") for w in words).strip()
        segments.append({"start":float(words[0]["start"]),"end":float(words[-1]["end"]),"text":text})
print(json.dumps([s for s in segments if s["text"] and s["end"]>s["start"]],ensure_ascii=False))
