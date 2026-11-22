var e=Math.fround,t=e(Math.PI);function n(t,n,r){let i=2**Math.max(t,0),a=Math.min(Math.max((n+.5)/i,0),1),o=2*Math.atan(Math.exp((1-2*a)*Math.PI))-Math.PI/2;return e(2*Math.PI*6378137*Math.cos(o)/i/Math.max(r,1))}function r(t){let n=[],r=1;for(;r<=t;)n.push(r),r=Math.max(r+1,Math.floor(e(r*1.25)));return n}var i=e=>Math.sign(e)*Math.round(Math.abs(e));function a(n,a){let o=r(e(a.radiusMetres/n)),s=new ArrayBuffer(Math.max(1,a.directions*o.length)*16),c=new Int32Array(s),l=new Float32Array(s),u=0;for(let r=0;r<a.directions;r++){let s=e(e(e(2*t)*r)/a.directions),d=e(Math.cos(s)),f=e(Math.sin(s));for(let t of o)c[u*4]=i(e(d*t)),c[u*4+1]=i(e(f*t)),l[u*4+2]=e(1/e(t*n)),u++}return{data:s,stepCount:o.length}}var o=class{device;pipeline;encoded=[];constructor(e){this.device=e,this.pipeline=e.createComputePipeline({label:`terrain occlusion`,layout:`auto`,compute:{module:e.createShaderModule({label:`terrain occlusion`,code:`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// The terrain's occlusion of the sky (decision B10), the Swift
// \`GroundReliefOcclusion.compute\` as a compute shader over the relief's
// r16float height texture: one invocation per point of the grid, the same
// rays (the texel offsets and one over the metres of each step, built on
// the CPU by ground-relief-occlusion-gpu.ts), the same loop order and the
// same rounding, so the bytes are the Swift engine's. They go into a
// storage buffer of rows padded to 256 bytes, four to a word, which is
// copied into the r8unorm texture the fills sample.

struct Params {
  size: u32,
  resolution: u32,
  directions: u32,
  stepCount: u32,
  share: f32,
  rowWords: u32,
}

@group(0) @binding(0) var heights: texture_2d<f32>;
// x and y offsets in texels (as bits), one over the step's metres, per direction and step.
@group(0) @binding(1) var<storage, read> rays: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> occlusion: array<atomic<u32>>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let resolution = params.resolution;
  if (id.x >= resolution || id.y >= resolution) {
    return;
  }
  let size = i32(params.size);
  // (column + 0.5) * size / resolution, truncated, in integers.
  let x = i32(((2u * id.x + 1u) * params.size) / (2u * resolution));
  let y = i32(((2u * id.y + 1u) * params.size) / (2u * resolution));
  let base = textureLoad(heights, vec2i(x, y), 0).r;
  var sum = 0.0;
  var index = 0u;
  for (var direction = 0u; direction < params.directions; direction++) {
    var steepest = 0.0;
    for (var step = 0u; step < params.stepCount; step++) {
      let ray = rays[index + step];
      let sample = vec2i(x, y) + bitcast<vec2i>(ray.xy);
      if (any(sample < vec2i(0)) || any(sample >= vec2i(size))) {
        break;
      }
      let slope = (textureLoad(heights, sample, 0).r - base) * ray.z;
      if (slope > steepest) {
        steepest = slope;
      }
    }
    sum += steepest / sqrt(1.0 + steepest * steepest);
    index += params.stepCount;
  }
  // Rounded half away from zero (the value is never negative), then clamped.
  let scaled = sum * params.share;
  var rounded = floor(scaled);
  if (scaled - rounded >= 0.5) {
    rounded += 1.0;
  }
  let value = u32(clamp(rounded, 0.0, 255.0));
  atomicOr(&occlusion[id.y * params.rowWords + id.x / 4u], value << (8u * (id.x % 4u)));
}
`}),entryPoint:`main`}})}compute(e,t,n){let r=this.device.createCommandEncoder({label:`terrain occlusion`}),i=this.encode(r,e,t,n);return this.device.queue.submit([r.finish()]),this.submitted(),i}encode(e,t,r,i,o){let s=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC,c=i.resolution;if(c<=0||!(i.radiusMetres>0)){let e=this.device.createTexture({label:`terrain occlusion (none)`,size:[1,1],format:`r8unorm`,usage:s});return this.device.queue.writeTexture({texture:e},new Uint8Array(1),{},[1,1]),e}let l=t.width,{data:u,stepCount:d}=a(n(r.z,r.y,l),i),f=Math.ceil(c/256)*256,p=this.device.createBuffer({label:`terrain occlusion rays`,size:u.byteLength,usage:GPUBufferUsage.STORAGE,mappedAtCreation:!0});new Uint8Array(p.getMappedRange()).set(new Uint8Array(u)),p.unmap();let m=this.device.createBuffer({label:`terrain occlusion params`,size:32,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:!0}),h=m.getMappedRange();new Uint32Array(h,0,4).set([l,c,i.directions,d]),new Float32Array(h,16,1)[0]=255/i.directions,new Uint32Array(h,20,1)[0]=f/4,m.unmap();let g=this.device.createBuffer({label:`terrain occlusion bytes`,size:f*c,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),_=this.device.createTexture({label:`terrain occlusion`,size:[c,c],format:`r8unorm`,usage:s}),v=this.device.createBindGroup({label:`terrain occlusion`,layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:t.createView()},{binding:1,resource:{buffer:p}},{binding:2,resource:{buffer:g}},{binding:3,resource:{buffer:m}}]}),y=e.beginComputePass(o?{label:`terrain occlusion`,timestampWrites:o}:{label:`terrain occlusion`});y.setPipeline(this.pipeline),y.setBindGroup(0,v);let b=Math.ceil(c/8);return y.dispatchWorkgroups(b,b),y.end(),e.copyBufferToTexture({buffer:g,bytesPerRow:f},{texture:_},[c,c]),this.encoded.push(p,m,g),_}submitted(){for(let e of this.encoded)e.destroy();this.encoded=[]}destroy(){this.submitted()}};export{o as t};