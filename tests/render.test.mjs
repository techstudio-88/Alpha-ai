import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import {renderEditedClip} from "../worker/server.js";
const exec=promisify(execFile);

test("real FFmpeg renders trimmed media at both speeds with captions and the requested canvas",{timeout:120000},async()=>{
  process.env.FFMPEG_PATH=ffmpeg;process.env.FFPROBE_PATH=ffprobe.path;
  await mkdir('/tmp/omnirush',{recursive:true});
  const dir=await mkdtemp(path.join("/tmp/omnirush","alpha-render-test-"));
  try{
    const source=path.join(dir,"source.mp4"),srt=path.join(dir,"captions.srt");
    await exec(ffmpeg,["-y","-f","lavfi","-i","testsrc2=size=320x240:rate=24","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","6","-c:v","libx264","-c:a","aac",source]);
    await writeFile(srt,"1\n00:00:00,000 --> 00:00:01,000\nCaption timing test\n");
    for(const speed of [.5,2]){
      const output=path.join(dir,`output-${speed}.mp4`);
      await renderEditedClip(source,output,1,5,{speed,aspect:"1:1",zoom:1.2,effect:"warm",transition:"fade",srtPath:srt,
        reframeKeyframes:[{time_seconds:0,x_center:.4,y_center:.5},{time_seconds:4,x_center:.6,y_center:.5}]});
      const {stdout}=await exec(ffprobe.path,["-v","quiet","-show_format","-show_streams","-of","json",output]);
      const probe=JSON.parse(stdout),video=probe.streams.find(s=>s.codec_type==="video");
      assert.ok(Math.abs(Number(probe.format.duration)-4/speed)<.3);
      assert.equal(video.width,1080);assert.equal(video.height,1080);
      assert.ok(probe.streams.some(s=>s.codec_type==="audio"));
    }
    const cutOutput=path.join(dir,'cut-output.mp4');
    await renderEditedClip(source,cutOutput,1,5,{aspect:'9:16',speed:1,cutRanges:[{start:2,end:3}]});
    const {stdout:cutProbe}=await exec(ffprobe.path,['-v','quiet','-show_format','-show_streams','-of','json',cutOutput]);
    const cut=JSON.parse(cutProbe);
    assert.ok(Math.abs(Number(cut.format.duration)-3)<.3);
    assert.equal(cut.streams.find(s=>s.codec_type==='video').height,1920);
    assert.ok(cut.streams.some(s=>s.codec_type==='audio'));
  }finally{await rm(dir,{recursive:true,force:true})}
});
