import"./modulepreload-polyfill-P2Xu9kJm.js";import{n as e,o as t,s as n,t as r}from"./harness-C3naXZKN.js";import{t as i}from"./ground-fog-Cze7ss3N.js";import{t as a}from"./shadow-DLRZa6eb.js";import{i as o,r as s}from"./shadow-uniform-uOIiLf2h.js";var c=2400,l=1720,u=6,d=4096,f=`
@group(0) @binding(0) var<uniform> shadow: Shadow;
@group(0) @binding(1) var shadowMap: texture_depth_2d_array;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var<uniform> groundFog: GroundFog;
@group(0) @binding(4) var mask: texture_2d<f32>;
@group(0) @binding(5) var maskSampler: sampler;

struct Out { @builtin(position) position: vec4f, @location(0) @interpolate(flat) layer: f32 }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) layer: u32) -> Out {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return Out(vec4f(p[v], 0.0, 1.0), f32(layer));
}

// A point of the scene under the pixel: metres, a wall or a roof by the pixel.
fn worldPoint(in: Out) -> vec3f {
  return vec3f((in.position.xy - vec2f(${c/2}.0, ${l/2}.0)) * 0.5, in.layer * 12.0 + fract(in.position.x * 0.013) * 30.0);
}
fn worldNormal(in: Out) -> vec3f {
  let a = in.position.x * 0.021 + in.position.y * 0.017;
  return normalize(select(vec3f(cos(a), sin(a), 0.0), vec3f(0.0, 0.0, 1.0), fract(in.position.y * 0.01) > 0.6));
}
`,p=`
const kWallShadeBase: f32 = 0.90;
const kWallShadeSunSwing: f32 = 0.07;
const kBaseDarkening: f32 = 0.88;
const kGradientRampMeters: f32 = 30.0;
fn cue(n: vec3f, h: f32, l: vec3f) -> f32 {
  let up = saturate(n.z);
  var sunSide = 0.0;
  let nl = length(n.xy);
  let sl = length(l.xy);
  if (nl > 1.0e-3 && sl > 1.0e-3) { sunSide = dot(n.xy / nl, l.xy / sl); }
  let orientation = mix(kWallShadeBase + kWallShadeSunSwing * sunSide, 1.0, up);
  return orientation * mix(kBaseDarkening, 1.0, smoothstep(0.0, kGradientRampMeters, h));
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let p = worldPoint(in);
  let n = worldNormal(in);
  let factor = sampleShadowFactor(shadow, shadowMap, shadowSampler, p, n);
  let applied = mix(1.0, cue(n, min(p.z, 1.0e4), shadow.lightDirection.xyz), factor);
  let color = vec3f(0.9, 0.89, 0.87) * applied * shadowColorMultiplier(shadow, factor);
  return vec4f(applyGroundFog(color, p, groundFog), 1.0);
}`,m=`
const kWallShadeBase: f16 = 0.90h;
const kWallShadeSunSwing: f16 = 0.07h;
const kBaseDarkening: f16 = 0.88h;
const kGradientRampMeters: f16 = 30.0h;
fn cue(n: vec3h, h: f16, l: vec3h) -> f16 {
  let up = saturate(n.z);
  var sunSide = 0.0h;
  let nl = length(n.xy);
  let sl = length(l.xy);
  if (nl > 1.0e-3h && sl > 1.0e-3h) { sunSide = dot(n.xy / nl, l.xy / sl); }
  let orientation = mix(kWallShadeBase + kWallShadeSunSwing * sunSide, 1.0h, up);
  return orientation * mix(kBaseDarkening, 1.0h, smoothstep(0.0h, kGradientRampMeters, h));
}
fn multiplierH(strength: f16, tint: vec3h, factor: f16) -> vec3h {
  if (strength <= 0.0h) { return vec3h(1.0h); }
  let amount = saturate((1.0h - factor) / strength);
  return mix(vec3h(1.0h), (1.0h - strength) * tint, amount);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let p = worldPoint(in);
  let n = worldNormal(in);
  let factor = f16(sampleShadowFactor(shadow, shadowMap, shadowSampler, p, n));
  let nh = vec3h(n);
  let applied = mix(1.0h, cue(nh, f16(min(p.z, 1.0e4)), vec3h(shadow.lightDirection.xyz)), factor);
  let color = vec3h(0.9h, 0.89h, 0.87h) * applied * multiplierH(f16(shadow.eyeAndStrength.w), vec3h(shadow.tint.xyz), factor);
  let amount = f16(groundFogAmount(p, groundFog));
  return vec4f(vec3f(mix(color, vec3h(groundFogColor(p, groundFog)), amount)), 1.0);
}`,h=`
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let p = vec3f(worldPoint(in).xy, 0.0);
  var multiplier = vec3f(1.0);
  if (shadow.eyeAndStrength.w > 0.0) {
    let factor = textureSampleLevel(mask, maskSampler, in.position.xy * 0.4 / vec2f(textureDimensions(mask)), 0.0).r;
    multiplier = shadowColorMultiplier(shadow, factor);
  }
  let color = vec3f(0.85 + in.layer * 0.01, 0.84, 0.8) * multiplier;
  return vec4f(applyGroundFog(color, p, groundFog), 0.9);
}`,g=`
fn multiplierH(strength: f16, tint: vec3h, factor: f16) -> vec3h {
  if (strength <= 0.0h) { return vec3h(1.0h); }
  let amount = saturate((1.0h - factor) / strength);
  return mix(vec3h(1.0h), (1.0h - strength) * tint, amount);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let p = vec3f(worldPoint(in).xy, 0.0);
  var multiplier = vec3h(1.0h);
  let strength = f16(shadow.eyeAndStrength.w);
  if (strength > 0.0h) {
    let factor = f16(textureSampleLevel(mask, maskSampler, in.position.xy * 0.4 / vec2f(textureDimensions(mask)), 0.0).r);
    multiplier = multiplierH(strength, vec3h(shadow.tint.xyz), factor);
  }
  let color = vec3h(0.85h + f16(in.layer) * 0.01h, 0.84h, 0.8h) * multiplier;
  let amount = f16(groundFogAmount(p, groundFog));
  return vec4f(vec3f(mix(color, vec3h(groundFogColor(p, groundFog)), amount)), 0.9);
}`,_=`
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> @builtin(position) vec4f {
  var h = i * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  let r = vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0;
  let corner = vec2f(f32(v & 1u), f32((v >> 1u) & 1u));
  let size = 0.01 + r.z * 0.03;
  return vec4f((r.xy * 2.0 - 1.0) + corner * size, 0.2 + r.z * 0.6, 1.0);
}`;function v(e,t,n){let r=new Float64Array(16);r[0]=.5/e,r[5]=-.5/e,r[10]=-1/400,r[12]=.5,r[13]=.5,r[14]=.6,r[15]=1;let i=4/d;return{worldToShadowTexture:r,tentSpread:1.5,fadeStartDistance:t,depthBias:4e-4,fadeEndDistance:n,uvMinimum:[i,i],uvMaximum:[.9990234375,.9990234375],normalOffsetWorld:.3,texelSizeUV:[1/d,1/d]}}async function y(){let e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!e.features.has(`timestamp-query`))throw Error(`B15 needs timestamp-query`);let y=e.features.has(`shader-f16`),b=await e.requestDevice({requiredFeatures:y?[`timestamp-query`,`shader-f16`]:[`timestamp-query`]}),x=`bgra8unorm`,S=b.createTexture({size:[c,l],format:x,usage:GPUTextureUsage.RENDER_ATTACHMENT}),C=b.createTexture({size:[d,d,2],format:`depth16unorm`,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),w=b.createTexture({size:[Math.ceil(c*.4),Math.ceil(l*.4)],format:`r8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});{let e=w.width,t=w.height,n=Math.ceil(e/256)*256,r=new Uint8Array(n*t);for(let i=0;i<t;i++)for(let t=0;t<e;t++)r[i*n+t]=((t>>5)+(i>>5))%3==0?170:255;b.queue.writeTexture({texture:w},r,{bytesPerRow:n},[e,t])}{let e=b.createShaderModule({code:_}),t=b.createRenderPipeline({layout:`auto`,vertex:{module:e,entryPoint:`vs`},primitive:{topology:`triangle-strip`},depthStencil:{format:`depth16unorm`,depthWriteEnabled:!0,depthCompare:`less-equal`}}),n=b.createCommandEncoder();for(let e=0;e<2;e++){let r=n.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:C.createView({dimension:`2d`,baseArrayLayer:e,arrayLayerCount:1}),depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`store`}});r.setPipeline(t),r.draw(4,2e4),r.end()}b.queue.submit([n.finish()])}let T=b.createBuffer({size:s.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),E=new Float32Array(s.byteLength/4);o(E,0,{near:v(500,300,400),far:v(1400,900,1200),eye:[0,-800,400],strength:.22,lightDirection:[-.33,-.49,.81],tint:[.88,.92,1],fadeCenter:[0,-100]}),b.queue.writeBuffer(T,0,E);let D=b.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});b.queue.writeBuffer(D,0,new Float32Array([.8,.85,.9,3e-4,0,-800,400,1,300,200,.8,1,.6,.7,.9,.05,100,0,0,0]));let O=b.createQuerySet({type:`timestamp`,count:2}),k=b.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),A=b.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),j=b.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`depth`,viewDimension:`2d-array`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`comparison`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]}),M=b.createBindGroup({layout:j,entries:[{binding:0,resource:{buffer:T}},{binding:1,resource:C.createView({dimension:`2d-array`})},{binding:2,resource:b.createSampler({compare:`less-equal`,minFilter:`linear`,magFilter:`linear`})},{binding:3,resource:{buffer:D}},{binding:4,resource:w.createView()},{binding:5,resource:b.createSampler({minFilter:`linear`,magFilter:`linear`})}]}),N=(e,t,n)=>{let r=b.createShaderModule({code:[t?`enable f16;`:``,a,i,f,e].join(`
`)});return b.createRenderPipeline({layout:b.createPipelineLayout({bindGroupLayouts:[j]}),vertex:{module:r,entryPoint:`vs`},fragment:{module:r,entryPoint:`fs`,targets:[{format:x,...n?{blend:{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}}:{}}]},primitive:{topology:`triangle-list`}})},P=[[`buildings`,`f32`,N(p,!1,!1)],[`ground`,`f32`,N(h,!1,!0)]];y&&P.push([`buildings`,`f16`,N(m,!0,!1)],[`ground`,`f16`,N(g,!0,!0)]);let F=Number(new URLSearchParams(location.search).get(`frames`)??200),I=new Map;for(let e=0;e<F+20;e++)for(let[t,n,r]of P){let i=b.createCommandEncoder(),a=i.beginRenderPass({colorAttachments:[{view:S.createView(),loadOp:`clear`,storeOp:`store`,clearValue:{r:0,g:0,b:0,a:1}}],timestampWrites:{querySet:O,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});a.setPipeline(r),a.setBindGroup(0,M),a.draw(3,u),a.end(),i.resolveQuerySet(O,0,2,k,0),i.copyBufferToBuffer(k,0,A,0,16),b.queue.submit([i.finish()]),await A.mapAsync(GPUMapMode.READ);let[o,s]=new BigInt64Array(A.getMappedRange());A.unmap();let c=`${t}|${n}`;e>=20&&(I.get(c)??I.set(c,[]).get(c)).push(Number(s-o)/1e6)}let L=[],R=[];for(let[e,t]of I){let[r,i]=e.split(`|`),a=n(t);L.push([`${r}, ${u} layers, ${c}x${l}`,i,a.median,a.p95]),R.push({scene:r,precision:i,gpu:a})}y||L.push([`(no shader-f16 on this adapter)`,`f16`,`n/a`,`n/a`]),t(`B15: GPU ms per pass, f32 against f16`,[`scene`,`precision`,`GPU median ms`,`GPU p95 ms`],L,{hasF16:y,raw:R}),r()}y().catch(e);