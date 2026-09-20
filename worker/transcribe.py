import glob,json,os,subprocess,sys,tempfile
audio=sys.argv[1]
model_name=sys.argv[2] if len(sys.argv)>2 else "tiny"
model_path="/opt/whisper.cpp/models/ggml-tiny-q5_1.bin" if model_name=="tiny" else "/opt/whisper.cpp/models/ggml-"+model_name+".bin"

if not os.path.exists(model_path):
    os.makedirs(os.path.dirname(model_path),exist_ok=True)
    url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin?download=true"
    subprocess.run(["curl","-L","--fail","--retry","3","-o",model_path,url],check=True)

if not os.path.exists(model_path):
    raise SystemExit("Whisper model not found: "+model_path)

with tempfile.TemporaryDirectory(prefix="alpha-whisper-") as d:
    out=os.path.join(d,"result")
    matches=glob.glob("/opt/whisper.cpp/**/whisper-cli",recursive=True)+glob.glob("/opt/whisper.cpp/**/main",recursive=True)
    binary=next((p for p in matches if os.path.isfile(p) and os.access(p,os.X_OK)),None)
    if not binary:
        raise SystemExit("Whisper CLI binary not found")
    cmd=[binary,"-m",model_path,"-f",audio,"-oj","-of",out,"-np","-ng","-t","1","-l","auto"]
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with open(out+".json","r",encoding="utf-8") as f:
        data=json.load(f)

segments=[]
for s in data.get("transcription",[]):
    off=s.get("offsets") or {}
    start=float(off.get("from",0))/1000.0
    end=float(off.get("to",0))/1000.0
    text=(s.get("text") or "").strip()
    if text and end>start:
        segments.append({"start":start,"end":end,"text":text})
print(json.dumps(segments,ensure_ascii=False))