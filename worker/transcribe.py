import json,sys
from faster_whisper import WhisperModel
audio=sys.argv[1]
model_name=sys.argv[2] if len(sys.argv)>2 else "small"
model=WhisperModel(model_name,device="cpu",compute_type="int8")
segments,_=model.transcribe(audio,language=None,vad_filter=True,word_timestamps=False)
out=[]
for s in segments:
    text=s.text.strip()
    if text:
        out.append({"start":s.start,"end":s.end,"text":text})
print(json.dumps(out,ensure_ascii=False))
