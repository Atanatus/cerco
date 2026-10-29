const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('playlist uses existing MP3 files in numerical order and preserves Track1/Track2',()=>{
  const scope={window:{}}; vm.runInNewContext(fs.readFileSync('src/js/music-playlist.js','utf8'),scope);
  const tracks=JSON.parse(JSON.stringify(scope.window.PROYECTOZ_TRACKS));
  assert.deepEqual(tracks.map(t=>Number(t.src.match(/Track(\d+)\.mp3$/)[1])),[1,2,3,4,5,6,8,9]);
  assert.deepEqual(tracks.slice(0,2).map(t=>t.title),['A River of Stone','The Silver Bridge']);
  for(const track of tracks){
    const data=fs.readFileSync(track.src);
    assert.ok(data.length>1000);
    assert.ok(data.subarray(0,3).toString()==='ID3'||(data[0]===255&&(data[1]&224)===224),'MP3 header: '+track.src);
  }
});
