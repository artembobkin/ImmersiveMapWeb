import{i as e,o as t}from"./matrix-B-Py987m.js";import{t as n}from"./immersive-map-projection-DE6pDzxw.js";import{t as r}from"./ground-fog-Cze7ss3N.js";var i={fillVertexStride:12,fillIndexStride:4,lineSegmentStride:24,discStride:24,roundStart:1,roundEnd:2},a={version:1,magic:`IMLW`,blockCount:4,headerSize:76,chunkStride:64,decode(e){let t=e.byteLength;if(t<a.headerSize)return;let n=new DataView(e);for(let e=0;e<4;e++)if(n.getUint8(e)!==a.magic.charCodeAt(e))return;if(n.getUint32(4,!0)!==a.version)return;let r=n.getUint32(8,!0);if(r>=1<<24||a.headerSize+r*a.chunkStride>t)return;let o=[];for(let e=0;e<a.blockCount;e++){let r=Number(n.getBigUint64(12+e*16,!0)),i=Number(n.getBigUint64(20+e*16,!0));if(r>t||i>t-r)return;o.push({offset:r,size:i})}let[s,c,l,u]=o,d=Math.floor(c.size/i.fillIndexStride),f=Math.floor(l.size/i.lineSegmentStride),p=Math.floor(u.size/i.discStride),m=[];for(let e=0;e<r;e++){let t=a.headerSize+e*a.chunkStride,r=e=>n.getUint32(t+12+e*4,!0),i=e=>n.getFloat32(t+44+e*4,!0),o={x:n.getInt32(t,!0),y:n.getInt32(t+4,!0),z:n.getInt32(t+8,!0),fillIndexStart:r(0),fillIndexCount:r(1),lineStart:r(2),lineCount:r(3),joinStart:r(4),joinCount:r(5),pointStart:r(6),pointCount:r(7),boundsMinimum:[i(0),i(1)],boundsMaximum:[i(2),i(3)],maximumReachPoints:i(4)};if(o.fillIndexStart+o.fillIndexCount>d||o.lineStart+o.lineCount>f||o.joinStart+o.joinCount>p||o.pointStart+o.pointCount>p)return;m.push(o)}return{chunks:m,fillVertices:s,fillIndices:c,lineSegments:l,discs:u}}},o=4294967295,s={simple:1,polygon:2,polyline:3,point:4},c={fill:1,fillOpacity:2,stroke:4,strokeOpacity:8,strokeWidth:16,markerColor:32,markerRadius:64};function l(e,t,n){e[t]=s.polygon,e.set(n.fillColor,t+1),e.set(n.strokeColor,t+5),e[t+9]=n.strokeWidthPoints}function u(e,t,n){e[t]=s.polyline,e.set(n.color,t+1),e[t+5]=n.widthPoints}function d(e,t,n){e[t]=s.point,e.set(n.color,t+1),e[t+5]=n.radiusPoints,e.set(n.strokeColor,t+6),e[t+10]=n.strokeWidthPoints}function f(e,t,n){if(t===4294967295)return n;let r=t*16,i=e[r];if(i===s.polygon)return{fillColor:h(e,r+1),strokeColor:h(e,r+5),strokeWidthPoints:Math.max(e[r+9],0)};if(i!==s.simple)return n;let a=e[r+1];return(a&(c.fill|c.fillOpacity|c.stroke|c.strokeOpacity|c.strokeWidth))===0?n:{fillColor:g(e,r+2,a&c.fill,r+5,a&c.fillOpacity,n.fillColor),strokeColor:g(e,r+6,a&c.stroke,r+9,a&c.strokeOpacity,n.strokeColor),strokeWidthPoints:a&c.strokeWidth?e[r+10]:n.strokeWidthPoints}}function p(e,t,n){if(t===4294967295)return n;let r=t*16,i=e[r];if(i===s.polyline)return{color:h(e,r+1),widthPoints:Math.max(e[r+5],0)};if(i!==s.simple)return n;let a=e[r+1];return(a&(c.stroke|c.strokeOpacity|c.strokeWidth))===0?n:{color:g(e,r+6,a&c.stroke,r+9,a&c.strokeOpacity,n.color),widthPoints:a&c.strokeWidth?e[r+10]:n.widthPoints}}function m(e,t,n){if(t===4294967295)return n;let r=t*16,i=e[r];if(i===s.point)return{color:h(e,r+1),radiusPoints:Math.max(e[r+5],0),strokeColor:h(e,r+6),strokeWidthPoints:Math.max(e[r+10],0)};if(i!==s.simple)return n;let a=e[r+1];return(a&(c.markerColor|c.markerRadius))===0?n:{color:g(e,r+11,a&c.markerColor,-1,0,n.color),radiusPoints:a&c.markerRadius?e[r+14]:n.radiusPoints,strokeColor:n.strokeColor,strokeWidthPoints:n.strokeWidthPoints}}function h(e,t){return[e[t],e[t+1],e[t+2],e[t+3]]}function g(e,t,n,r,i,a){return[n?e[t]:a[0],n?e[t+1]:a[1],n?e[t+2]:a[2],i?e[r]:a[3]]}var _={rotationMatrix(e,t){let n=Math.cos(-e),r=Math.sin(-e),i=Math.cos(-t),a=Math.sin(-t);return Float64Array.of(i,0,-a,0,a*r,n,i*r,0,a*n,-r,i*n,0,0,0,0,1)},globeRotationMatrix(e){return _.rotationMatrix(e.panY*n.maxMercatorLatitude,e.panX*Math.PI)},earthDirection(e,t){let n=e*Math.PI/180,r=t*Math.PI/180;return[Math.cos(n)*Math.sin(r),Math.sin(n),Math.cos(n)*Math.cos(r)]},sunWorldDirection(e,t){let[n,r,i]=_.earthDirection(e.subsolarLatitudeDegrees,e.subsolarLongitudeDegrees),a=_.globeRotationMatrix(t),o=a[0]*n+a[1]*r+a[2]*i,s=a[4]*n+a[5]*r+a[6]*i,c=a[8]*n+a[9]*r+a[10]*i,l=Math.hypot(o,s,c);return[o/l,s/l,c/l]}},v={make(r,i){let a=r.panY*n.maxMercatorLatitude,o=r.panX*Math.PI,s=(1-r.transition)*Math.cos(a)+r.transition,c=2*Math.PI*r.radius*s,l=n.yMercatorNormalized(a),u=_.rotationMatrix(a,o),d=r.radius,f=t(new Float64Array(16),u);for(let e=0;e<12;e++)f[e]=f[e]*d;return f[14]-=d,{rotation:u,sphereClip:e(new Float64Array(16),i,f),sphereWorld:f,mapSize:c,panMercatorY:l,panLatitude:a,panLongitude:o,curvature:(1-r.transition)/Math.max(d,1e-6)}}},y={isPureSphere(e,t){return e===`spherical`&&t===0}},b={of(e){let t=2**e.z;return{uvOrigin:[e.x/t,e.y/t],uvScale:1/t,referenceWorldX:(e.x+.5)/t}},write(e,t,n){let r=2**n.z;e[t]=n.x/r,e[t+1]=n.y/r,e[t+2]=1/r,e[t+3]=(n.x+.5)/r}},x={coarseTileDashScale(e){return e<=1?.7:e===2?.9:1}},S=[`tunnel`,`ground`,`automobileGround`,`bridge`],C=[`shadow`,`casing`,`fill`,`detail`,`overlay`],w={layerDepthStep:32e-7,classDepthBand:257*32e-7,flatRoadsDepthOffset:600*32e-7,appLayersRank:1210,surfaceLabelsRank:1220,realGeometryRank:1536},T=(()=>{let e=[`shadow`,`casing`,`fill`,`detail`],t=S.length*e.length,n=(n,r)=>{let i=Math.max(0,S.indexOf(n)),a=e.indexOf(r);return a>=0?i*e.length+a:t+1+i},r=e=>w.flatRoadsDepthOffset+e*12*w.layerDepthStep,i=[];for(let e of S)for(let t of C)i.push({structureKind:e,role:t,band:n(e,t)});return i.sort((e,t)=>t.band-e.band),{ranksPerBand:12,bridgeOverlayBand:t,bandCount:t+1+S.length,band:n,depthOffset:r,layersNearestFirst:i}})(),E={reference:e=>Math.min(Math.max(e,0),16)+1,priorityMask:63,groundHoleBit:64,surfaceMaskBit:128},D=.5,O=class e{functions;overrides;globals;static cache=new Map;reached=new Map;constructor(e,t,n){this.functions=e,this.overrides=t,this.globals=n}static of(t){let n=e.cache.get(t);return n||(n=e.read(t),e.cache.set(t,n)),n}used(e){let t=this.reached.get(e);if(t)return t;let n=this.functions.get(e);if(n===void 0)throw Error(`The shader has no entry point ${e}`);let r=new Set,i=new Set([e]),a=[n];for(;a.length>0;)for(let e of j(a.pop())){if(i.has(e))continue;i.add(e);let t=this.overrides.get(e);t!==void 0&&(r.add(e),a.push(t));let n=this.functions.get(e)??this.globals.get(e);n!==void 0&&a.push(n)}return t=r,this.reached.set(e,t),t}constants(e,t){let n=this.used(e),r=Object.entries(t).filter(([e])=>n.has(e));return r.length===0?void 0:Object.fromEntries(r)}static read(t){let n=k(t),r=new Map,i=new Map,a=new Map,o=0,s=0,c=/\b(fn|override|var|const)\b(?:\s*<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)/y;for(;s<n.length;){let e=n[s];if(e===`{`)o++;else if(e===`}`)o--;else if(o===0){c.lastIndex=s;let e=c.exec(n);if(e&&(s===0||!/[A-Za-z0-9_]/.test(n[s-1]))){let[t,o,c]=e,l=s+t.length;if(o===`fn`){let e=n.indexOf(`{`,l),t=A(n,e);r.set(c,n.slice(e+1,t)),s=t+1;continue}let u=n.indexOf(`;`,l),d=/=(.*)$/s.exec(n.slice(l,u))?.[1]??``;(o===`override`?i:a).set(c,d),s=u+1;continue}}s++}return new e(r,i,a)}};function k(e){return e.replace(/\/\*[\s\S]*?\*\//g,` `).replace(/\/\/[^\n]*/g,``)}function A(e,t){let n=0;for(let r=t;r<e.length;r++)if(e[r]===`{`)n++;else if(e[r]===`}`&&--n===0)return r;throw Error(`The shader has an unclosed brace`)}function j(e){return(function*(){for(let t of e.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g))yield t[0]})()}function M(e,t,n){let r=O.of(e).constants(t,n);return r===void 0?{entryPoint:t}:{entryPoint:t,constants:r}}var N=`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// library
// The globe's projection and light, shared by every surface the globe draws
// (the vector ground, the raster rings, the placement marks, the polar
// caps). A port of the Swift engine's GlobeTileProjection.h,
// GlobeTransitionProjection.h, GlobeUnroll.h and GlobeLight.h, against the
// frame's uniform (globe-frame-uniform.ts).
//
// The unroll: the morph never mixes positions through the planet's
// interior. The surface lives on a sphere of radius 1 / curvature tangent to
// the view centre, with curvature = (1 - transition) / radius, and every
// point travels a straight line in the chart between its
// azimuthal-equidistant image about the view centre and its Mercator
// position, the blended chart point wrapped onto the growing sphere. At
// transition 0 the surface is exactly the sphere, at 1 exactly the flat
// Mercator world. A vertex whose remaining chart travel exceeds
// kGlobeUnrollCutTravel of a radius is cut (it is content past a pole or
// opposite the view, on its way half a map sideways). The CPU mirror is
// globe-unroll-math.ts.

/// Mirror of GlobeFrameUniformLayout.
struct GlobeFrame {
    sphereClip: mat4x4f,
    sphereWorld: mat4x4f,
    pan: vec2f,
    radius: f32,
    transition: f32,
    mapSize: f32,
    panMercatorY: f32,
    handover: f32,
    padding: f32,
    lightAndStrength: vec4f,
    nightColorAndSoftness: vec4f,
}

const kGlobePi: f32 = 3.14159265358979;
/// The unroll's cut, a fraction of the planet radius (GlobeUnrollMath.cutTravelFraction).
const kGlobeUnrollCutTravel: f32 = 0.25;

/// The unit earth-fixed direction of a world uv (x east in turns, y the
/// Mercator row, both 0..1 across the world), straight through the
/// Gudermannian identities (sin lat = tanh x, cos lat = sech x for
/// x = pi (1 - 2 v)): y the pole axis, z toward longitude 0, x toward 90
/// degrees east.
fn globeWorldUVUnitDirection(worldUv: vec2f) -> vec3f {
    let x = kGlobePi * (1.0 - 2.0 * worldUv.y);
    let e = exp(x);
    let inverseE = 1.0 / e;
    let sinLatitude = (e - inverseE) / (e + inverseE);
    let cosLatitude = 2.0 / (e + inverseE);
    let longitude = worldUv.x * (2.0 * kGlobePi) - kGlobePi;
    return vec3f(cosLatitude * sin(longitude), sinLatitude, cosLatitude * cos(longitude));
}

/// The value wrapped into one map width around 0 (the Swift GeoMath wrap).
fn globeWrap(x: f32, size: f32) -> f32 {
    return x - size * floor((x + size * 0.5) / size);
}

/// The flat morph target of a world point: x in the copy of the wrapped
/// world nearest the reference's (a tile's centre, so a tile at the seam of
/// the wrap stays in one piece), y the Mercator row about the pan's.
/// \`mercatorY\` is -1..1, north positive.
fn globeTransitionFlatWorldPosition(normalizedWorldX: f32, mercatorY: f32, referenceWorldX: f32, globe: GlobeFrame) -> vec2f {
    let halfMapSize = globe.mapSize * 0.5;
    let panOffset = globe.pan.x * halfMapSize - halfMapSize;
    let reference = globeWrap(referenceWorldX * globe.mapSize + panOffset, globe.mapSize);
    let value = normalizedWorldX * globe.mapSize + panOffset;
    let x = reference + globeWrap(value - reference, globe.mapSize);
    return vec2f(x, (mercatorY - globe.panMercatorY) * halfMapSize);
}

/// The azimuthal-equidistant image of a sphere position about the view
/// centre: arc times departure bearing.
fn globeUnrollChartAE(sphereWorldPosition: vec3f, radius: f32) -> vec2f {
    let fromCenter = sphereWorldPosition - vec3f(0.0, 0.0, -radius);
    let cosTheta = clamp(fromCenter.z / max(radius, 1e-6), -1.0, 1.0);
    let arcSphere = radius * acos(cosTheta);
    let dirSphere = fromCenter.xy;
    let dirSphereLength = length(dirSphere);
    return select(vec2f(0.0), dirSphere * (arcSphere / dirSphereLength), dirSphereLength > 1e-6);
}

/// Positive once the vertex's remaining chart travel is short enough to
/// show, normalized by the radius so the clip distances stay of order one.
fn globeUnrollCutClearance(sphereWorldPosition: vec3f, flatWorldPosition: vec2f, transition: f32, radius: f32) -> f32 {
    let chartAE = globeUnrollChartAE(sphereWorldPosition, radius);
    let remaining = (1.0 - transition) * length(flatWorldPosition - chartAE);
    return kGlobeUnrollCutTravel - remaining / max(radius, 1e-6);
}

fn globeUnrollWorldPosition(sphereWorldPosition: vec3f, flatWorldPosition: vec2f, transition: f32, radius: f32) -> vec3f {
    let curvature = (1.0 - transition) / max(radius, 1e-6);
    if (curvature <= 1e-9) {
        return vec3f(flatWorldPosition, 0.0);
    }
    // The straight chart line between the two flat images of the point.
    let chartPoint = mix(globeUnrollChartAE(sphereWorldPosition, radius), flatWorldPosition, transition);
    let arc = length(chartPoint);
    if (arc <= 1e-6) {
        return vec3f(chartPoint, 0.0);
    }
    let azimuth = chartPoint / arc;
    let angle = arc * curvature;
    let rho = sin(angle) / curvature;
    let sag = (cos(angle) - 1.0) / curvature;
    return vec3f(azimuth * rho, sag);
}

/// A surface point of a world uv on the frame's surface: its unit earth
/// direction (what \`sphereClip\` takes to clip space on the resting sphere),
/// its world position through the unroll toward the plane (\`morph\` only),
/// the sphere's world normal there, and the cut's clearance (1 on the
/// resting sphere).
struct GlobeSurfacePoint {
    unitDirection: vec3f,
    world: vec3f,
    normal: vec3f,
    clearance: f32,
}

fn globeSurfacePoint(worldUv: vec2f, referenceWorldX: f32, morph: bool, globe: GlobeFrame) -> GlobeSurfacePoint {
    let unitDirection = globeWorldUVUnitDirection(worldUv);
    let sphereWorldPosition = (globe.sphereWorld * vec4f(unitDirection, 1.0)).xyz;
    var point: GlobeSurfacePoint;
    point.unitDirection = unitDirection;
    point.normal = (globe.sphereWorld * vec4f(unitDirection, 0.0)).xyz;
    point.world = sphereWorldPosition;
    point.clearance = 1.0;
    if (morph) {
        // The flat morph target is the Mercator plane, and the world uv
        // already is its Mercator coordinate: only the convention changes
        // (the uv row runs 0..1 from the north edge, the projection wants
        // -1..1 north positive, clamped to the Mercator range).
        let mercatorY = clamp(1.0 - 2.0 * worldUv.y, -1.0, 1.0);
        let flatWorldPosition = globeTransitionFlatWorldPosition(worldUv.x, mercatorY, referenceWorldX, globe);
        point.world = globeUnrollWorldPosition(sphereWorldPosition, flatWorldPosition, globe.transition, globe.radius);
        point.clearance = globeUnrollCutClearance(sphereWorldPosition, flatWorldPosition, globe.transition, globe.radius);
    }
    return point;
}

/// The clip position of a surface point: the composed matrix on the
/// resting sphere, the camera's over the unrolled position in the morph.
fn globeSurfaceClip(point: GlobeSurfacePoint, morph: bool, cameraMatrix: mat4x4f, globe: GlobeFrame) -> vec4f {
    if (morph) {
        return cameraMatrix * vec4f(point.world, 1.0);
    }
    return globe.sphereClip * vec4f(point.unitDirection, 1.0);
}

/// A surface colour under the globe's light at a point whose sphere normal
/// (world space) is \`normal\`: the colour itself where the normal faces the
/// sun, toward the night colour where it faces away, a smoothstep across
/// the terminator, all of it scaled by the strength.
fn globeLitColor(color: vec3f, normal: vec3f, globe: GlobeFrame) -> vec3f {
    let strength = globe.lightAndStrength.w;
    if (strength <= 0.0) {
        return color;
    }
    let softness = max(globe.nightColorAndSoftness.w, 1e-3);
    let day = smoothstep(-softness, softness, dot(normalize(normal), globe.lightAndStrength.xyz));
    return mix(color, globe.nightColorAndSoftness.rgb, strength * (1.0 - day));
}
`,P=`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// library
// The first file of every globe module that clips by the unroll's cut: the
// cut is a clip distance where the device has \`clip-distances\`. Lines that
// end in the clip-distances marker are kept only there, lines that end in
// the no-clip-distances marker only without it, where the fragment stage
// discards by the interpolated clearance instead (clipDistanceVariant).
enable clip_distances; // clip-distances
`,F=`// clip-distances`,I=`// no-clip-distances`;function L(e,t){let n=t?I:F;return e.split(`
`).filter(e=>!e.trimEnd().endsWith(n)).join(`
`)}function R(e,t,n){return L([P,...t,N,n].join(`
`),e)}var z=`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// requires: ../../globe/shaders/clip-distances.wgsl ../../ground-fog/shaders/ground-fog.wgsl ../../globe/shaders/globe.wgsl
// The layers of the app's data (ImmersiveMapLayer): zones, lines and points
// lying on the ground, a port of the Swift engine's Layers.metal. Their
// geometry is stored as a map tile's is, in the render units of a chunk tile
// (crates/layer-mesh), and each vertex is projected the ground's own way, on
// the surface the frame draws (kLayerSurface), as the labels painted on the
// map are (surface-label.wgsl):
//
// - the flat map, through the chunk's origin and scale,
// - the resting sphere, the unit earth direction through the composed
//   sphere matrix,
// - the unroll, the sphere-to-plane unroll with its cut.
//
// A zone is its triangles. A line is an instance per segment, a shape of the
// screen as wide as the line in points, with round ends as half octagons:
// two segments that meet are joined by the disc their ends share, and no
// geometry of its own is drawn for a join. A line is solid and is the one
// thing here drawn without blending, and its fragment never discards, so a
// tile-based GPU shades each pixel once however many segments lie on it. A
// point is a disc with a ring round it, a quad on screen. Nothing is written
// to depth. What stands in front of a layer (a building, a model, a tree)
// covers it by the surface mask bit it raised in the stencil. The ground's
// depth hides it only on a layer that asks (hidesBehindTerrain), for which
// its z is one constant depth in the ground's far-plane band, a step behind
// the labels painted on the map, and on the relief the relief's own band, so
// a mountain nearer the camera covers it.
//
// The draw's record (group 1, read at the draw's index): a zone's draw is
// its instance index, a line's and a disc's ride on the vertex index, whose
// base the draw sets to the record times kLayerCornerSlots (the instance
// index is the segment's or the disc's).

struct Camera {
    matrix: mat4x4f,
    eye: vec3f,
}

/// One draw, 80 bytes (layer-render-subsystem.ts): the chunk tile (flat:
/// origin and scale, sphere: GlobeSurfaceTile), the drawable in pixels, the
/// pixels per point and the depth the layer lies at, and 1 in params.x for a
/// layer on the relief's band.
struct LayerDraw {
    tile: vec4f,
    screen: vec4f,
    params: vec4f,
    padding0: vec4f,
    padding1: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(2) var<uniform> groundFog: GroundFog;
@group(0) @binding(3) var<uniform> globe: GlobeFrame;
@group(1) @binding(0) var<storage, read> draws: array<LayerDraw>;

/// The surface the frame draws: 0 the flat map, 1 the resting sphere, 2 the unroll.
override kLayerSurface: u32 = 0u;

const kLayerTileExtent: f32 = 4096.0;
// The scale the projection applies to the z of everything real
// (RenderCamera.realDepthScale): the flat surface and the unroll divide it
// out and apply the layer's own depth, as the labels painted on the map do.
const kLayerRealDepthScale: f32 = 1.0 - 1536.0 * 3.2e-6;
// The relief's band (tile.wgsl): the raised ground keeps the real geometry's
// depth scale, its band a quarter as deep and two steps behind it.
const kLayerReliefBandScale: f32 = 0.25;
const kLayerReliefGroundBehind: f32 = 2.0 * 3.2e-6;
// A vertex nearer the camera than this in clip w is behind it.
const kLayerNearW: f32 = 1.0e-4;
// The vertex indices a line's or a disc's draw takes a record: its base is the record times this.
const kLayerCornerSlots: u32 = 16u;

/// A point of the surface in clip space, with what the fragment needs.
struct LayerClip {
    position: vec4f,
    worldPosition: vec3f,
    sphereNormal: vec3f,
    // Negative where the surface hides the point: the far side of the
    // sphere, the unroll's cut.
    clearance: f32,
}

fn layerProject(local: vec2f, draw: LayerDraw) -> LayerClip {
    var clip: LayerClip;
    if (kLayerSurface == 0u) {
        let world = vec3f(draw.tile.xy + local * draw.tile.z, 0.0);
        clip.position = camera.matrix * vec4f(world, 1.0);
        if (draw.params.x > 0.5) {
            clip.position.z *= 1.0 + kLayerReliefGroundBehind - (1.0 - draw.screen.w) * kLayerReliefBandScale;
        } else {
            clip.position.z *= draw.screen.w / kLayerRealDepthScale;
        }
        clip.worldPosition = world;
        clip.sphereNormal = vec3f(0.0, 0.0, 1.0);
        clip.clearance = 1.0;
        return clip;
    }
    let localUv = vec2f(local.x, kLayerTileExtent - local.y) / kLayerTileExtent;
    let worldUv = draw.tile.xy + localUv * draw.tile.z;
    let morph = kLayerSurface == 2u;
    let point = globeSurfacePoint(worldUv, draw.tile.w, morph, globe);
    clip.position = globeSurfaceClip(point, morph, camera.matrix, globe);
    clip.worldPosition = point.world;
    clip.sphereNormal = point.normal;
    if (morph) {
        clip.position.z *= draw.screen.w / kLayerRealDepthScale;
        clip.clearance = point.clearance;
    } else {
        clip.position.z = draw.screen.w * clip.position.w;
        // The far side of the planet: a zone's triangles go to back-face
        // culling, but a line's and a point's quads face the camera, so
        // every vertex is cut where the sphere turns away from the eye.
        clip.clearance = dot(normalize(point.normal), normalize(camera.eye - point.world));
    }
    return clip;
}

/// The colour as the ground under it is lit: the globe's sun on the sphere
/// and through the unroll, the ground fog on the plane.
fn layerShade(color: vec3f, worldPosition: vec3f, sphereNormal: vec3f) -> vec3f {
    var rgb = color;
    if (kLayerSurface != 0u) {
        rgb = globeLitColor(rgb, sphereNormal, globe);
    }
    return applyGroundFog(rgb, worldPosition, groundFog);
}

// MARK: Zones

struct LayerFillIn {
    @location(0) position: vec2f,
    @location(1) color: vec4f,
}

struct LayerFillOut {
    @builtin(position) position: vec4f,
    @builtin(clip_distances) cut: array<f32, 1>, // clip-distances
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) color: vec4f,
    @location(3) cutClearance: f32, // no-clip-distances
}

struct LayerFillFragmentIn {
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) color: vec4f,
    @location(3) cutClearance: f32, // no-clip-distances
}

@vertex
fn layerFillVertex(in: LayerFillIn, @builtin(instance_index) drawIndex: u32) -> LayerFillOut {
    let clip = layerProject(in.position, draws[drawIndex]);
    var out: LayerFillOut;
    out.position = clip.position;
    // The fill keeps the sphere's back-face culling for the far side: the cut is the unroll's alone.
    let clearance = select(clip.clearance, 1.0, kLayerSurface == 1u);
    out.cut[0] = clearance; // clip-distances
    out.cutClearance = clearance; // no-clip-distances
    out.worldPosition = clip.worldPosition;
    out.sphereNormal = clip.sphereNormal;
    out.color = in.color;
    return out;
}

@fragment
fn layerFillFragment(in: LayerFillFragmentIn) -> @location(0) vec4f {
    if (in.cutClearance < 0.0) { discard; } // no-clip-distances
    return vec4f(layerShade(in.color.rgb, in.worldPosition, in.sphereNormal), in.color.a);
}

// MARK: Lines

struct LayerLineIn {
    @location(0) start: vec2f,
    @location(1) end: vec2f,
    @location(2) widthPoints: f32,
    /// The colour's red, green and blue, and in the fourth byte which ends
    /// are round, 1 for the start and 2 for the end: a line is always solid.
    @location(3) color: vec4u,
}

struct LayerLineOut {
    @builtin(position) position: vec4f,
    @builtin(clip_distances) cut: array<f32, 1>, // clip-distances
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) color: vec3f,
    @location(3) cutClearance: f32, // no-clip-distances
}

struct LayerLineFragmentIn {
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) color: vec3f,
    @location(3) cutClearance: f32, // no-clip-distances
}

@vertex
fn layerLineVertex(in: LayerLineIn, @builtin(vertex_index) vertexIndex: u32) -> LayerLineOut {
    let draw = draws[vertexIndex / kLayerCornerSlots];
    let start = layerProject(in.start, draw);
    let end = layerProject(in.end, draw);
    // An end behind the camera is pulled to just before it along the
    // segment, so the shape's direction on screen stays the segment's.
    var startClip = start.position;
    var endClip = end.position;
    if (startClip.w < kLayerNearW && endClip.w > kLayerNearW) {
        startClip = mix(startClip, endClip, (kLayerNearW - startClip.w) / (endClip.w - startClip.w));
    } else if (endClip.w < kLayerNearW && startClip.w > kLayerNearW) {
        endClip = mix(endClip, startClip, (kLayerNearW - endClip.w) / (startClip.w - endClip.w));
    }
    let halfViewport = draw.screen.xy * 0.5;
    let startScreen = startClip.xy / max(startClip.w, kLayerNearW) * halfViewport;
    let endScreen = endClip.xy / max(endClip.w, kLayerNearW) * halfViewport;
    var direction = endScreen - startScreen;
    let length2 = dot(direction, direction);
    direction = select(vec2f(1.0, 0.0), direction * inverseSqrt(max(length2, 1.0e-30)), length2 > 1.0e-8);
    let normal = vec2f(-direction.y, direction.x);

    // The corners of a segment's shape, the same for every segment (the
    // index buffer joins them into triangles): which end the corner is at,
    // how far it stands from that end along the segment (outward positive)
    // and across it, in half widths. Each end is half an octagon, which
    // stands for a half disc at the widths a line has.
    var corners = array<vec3f, 10>(
        vec3f(0.0, 0.0, -1.0), vec3f(0.0, 0.0, 1.0),
        vec3f(0.0, 0.70710678, -0.70710678), vec3f(0.0, 0.70710678, 0.70710678), vec3f(0.0, 1.0, 0.0),
        vec3f(1.0, 0.0, -1.0), vec3f(1.0, 0.0, 1.0),
        vec3f(1.0, 0.70710678, -0.70710678), vec3f(1.0, 0.70710678, 0.70710678), vec3f(1.0, 1.0, 0.0),
    );
    let corner = corners[min(vertexIndex % kLayerCornerSlots, 9u)];
    let atEnd = corner.x > 0.5;
    let isRound = (in.color.a & select(1u, 2u, atEnd)) != 0u;
    // A round end reaches past the segment's end by the line's half width,
    // and two segments that meet with round ends overlap in a disc, their
    // join. A flat end stops at the segment's end: its corners fall onto the
    // end's edge and its triangles are empty.
    let outward = select(0.0, corner.y, isRound);
    let halfWidthPx = in.widthPoints * draw.screen.z * 0.5;
    let offsetPx = (normal * corner.z + direction * select(-outward, outward, atEnd)) * halfWidthPx;
    var position = select(startClip, endClip, atEnd);
    position = vec4f(position.xy + offsetPx / halfViewport * position.w, position.zw);
    let behind = startClip.w < kLayerNearW && endClip.w < kLayerNearW;
    let clearance = select(select(start.clearance, end.clearance, atEnd), -1.0, behind);

    var out: LayerLineOut;
    out.position = position;
    out.cut[0] = clearance; // clip-distances
    out.cutClearance = clearance; // no-clip-distances
    out.worldPosition = select(start.worldPosition, end.worldPosition, atEnd);
    out.sphereNormal = select(start.sphereNormal, end.sphereNormal, atEnd);
    out.color = vec3f(in.color.rgb) / 255.0;
    return out;
}

/// A line's fragment is whole: the shape is its geometry, with no edge to
/// soften and nothing to discard, and the pipeline does not blend. The
/// discard below is the cut's on a device without clip distances alone.
@fragment
fn layerLineFragment(in: LayerLineFragmentIn) -> @location(0) vec4f {
    if (in.cutClearance < 0.0) { discard; } // no-clip-distances
    return vec4f(layerShade(in.color, in.worldPosition, in.sphereNormal), 1.0);
}

// MARK: Points

struct LayerPointIn {
    @location(0) position: vec2f,
    @location(1) radiusPoints: f32,
    @location(2) strokeWidthPoints: f32,
    @location(3) color: vec4f,
    @location(4) strokeColor: vec4f,
}

struct LayerPointOut {
    @builtin(position) position: vec4f,
    @builtin(clip_distances) cut: array<f32, 1>, // clip-distances
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) @interpolate(flat) color: vec4f,
    @location(3) @interpolate(flat) strokeColor: vec4f,
    /// The fragment's offset from the centre, in pixels.
    @location(4) offsetPx: vec2f,
    /// The disc's radius and the ring's width, in pixels.
    @location(5) @interpolate(flat) sizePx: vec2f,
    @location(6) cutClearance: f32, // no-clip-distances
}

struct LayerPointFragmentIn {
    @location(0) worldPosition: vec3f,
    @location(1) sphereNormal: vec3f,
    @location(2) @interpolate(flat) color: vec4f,
    @location(3) @interpolate(flat) strokeColor: vec4f,
    @location(4) offsetPx: vec2f,
    @location(5) @interpolate(flat) sizePx: vec2f,
    @location(6) cutClearance: f32, // no-clip-distances
}

@vertex
fn layerPointVertex(in: LayerPointIn, @builtin(vertex_index) vertexIndex: u32) -> LayerPointOut {
    let draw = draws[vertexIndex / kLayerCornerSlots];
    let centre = layerProject(in.position, draw);
    let radiusPx = in.radiusPoints * draw.screen.z;
    let strokeWidthPx = in.strokeWidthPoints * draw.screen.z;
    let extentPx = radiusPx + strokeWidthPx + 1.0;
    var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
    let corner = corners[min(vertexIndex % kLayerCornerSlots, 5u)];
    let clearance = select(centre.clearance, -1.0, centre.position.w < kLayerNearW);

    var out: LayerPointOut;
    out.position = centre.position;
    out.position = vec4f(out.position.xy + corner * extentPx / (draw.screen.xy * 0.5) * out.position.w, out.position.zw);
    out.cut[0] = clearance; // clip-distances
    out.cutClearance = clearance; // no-clip-distances
    out.worldPosition = centre.worldPosition;
    out.sphereNormal = centre.sphereNormal;
    out.color = in.color;
    out.strokeColor = in.strokeColor;
    out.offsetPx = corner * extentPx;
    out.sizePx = vec2f(radiusPx, strokeWidthPx);
    return out;
}

@fragment
fn layerPointFragment(in: LayerPointFragmentIn) -> @location(0) vec4f {
    if (in.cutClearance < 0.0) { discard; } // no-clip-distances
    let distance = length(in.offsetPx);
    let radiusPx = in.sizePx.x;
    let strokeWidthPx = in.sizePx.y;
    // The disc, then the ring outside it, each with a pixel of antialiasing
    // at its edge. Outside the ring the coverage is zero, and so is the
    // alpha: the pipeline blends and writes neither depth nor stencil, so a
    // corner of the quad changes nothing without a discard.
    let inside = saturate(radiusPx + 0.5 - distance);
    let covered = saturate(radiusPx + strokeWidthPx + 0.5 - distance);
    var color = select(in.color, mix(in.strokeColor, in.color, inside), strokeWidthPx > 0.0);
    color.a *= covered;
    return vec4f(layerShade(color.rgb, in.worldPosition, in.sphereNormal), color.a);
}
`,B={flat:0,sphere:1,morph:2},V=[0,1,5,5,1,6,0,2,4,0,4,3,0,3,1,5,7,9,5,9,8,5,8,6],H={depth:1-w.appLayersRank*w.layerDepthStep},U={color:{operation:`add`,srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`},alpha:{operation:`add`,srcFactor:`one`,dstFactor:`one-minus-src-alpha`}},W=[{arrayStride:i.fillVertexStride,attributes:[{shaderLocation:0,offset:0,format:`float32x2`},{shaderLocation:1,offset:8,format:`unorm8x4`}]}],G=[{arrayStride:i.lineSegmentStride,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x2`},{shaderLocation:1,offset:8,format:`float32x2`},{shaderLocation:2,offset:16,format:`float32`},{shaderLocation:3,offset:20,format:`uint8x4`}]}],K=[{arrayStride:i.discStride,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x2`},{shaderLocation:1,offset:8,format:`float32`},{shaderLocation:2,offset:12,format:`float32`},{shaderLocation:3,offset:16,format:`unorm8x4`},{shaderLocation:4,offset:20,format:`unorm8x4`}]}],q=class{context;lineTemplateIndices;states;compiling;failed=!1;constructor(e){this.context=e;let t=new Uint16Array(V);this.lineTemplateIndices=e.device.createBuffer({label:`layer line template`,size:t.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0}),new Uint16Array(this.lineTemplateIndices.getMappedRange()).set(t),this.lineTemplateIndices.unmap()}get isReady(){return this.states!==void 0}prepare(e){this.compiling!==void 0||this.failed||(this.compiling=this.compile().then(t=>{this.states=t,e()}).catch(e=>{this.failed=!0,console.error(`ImmersiveMap could not compile the layers' pipelines: ${e instanceof Error?e.message:String(e)}`)}))}statesFor(e,t){return this.states?.get(`${e}/${t?`behind`:`over`}`)}destroy(){this.lineTemplateIndices.destroy()}async compile(){let{device:e,colorFormat:t,depthStencilFormat:n,sampleCount:i,clipDistances:a}=this.context,o=R(a,[r],z),s=e.createShaderModule({label:`layers`,code:o}),c=e.createPipelineLayout({label:`layers`,bindGroupLayouts:[this.context.frameLayout,this.context.drawLayout]}),l={compare:`equal`,failOp:`keep`,depthFailOp:`keep`,passOp:`keep`},u=(r,a,u)=>{let d={kLayerSurface:B[r]},f={module:s,...M(o,`layer${J(u)}Vertex`,d),buffers:u===`fill`?W:u===`line`?G:K},p={module:s,...M(o,`layer${J(u)}Fragment`,d),targets:[u===`line`?{format:t}:{format:t,blend:U}]};return e.createRenderPipelineAsync({label:`layers ${u} ${r} ${a?`behind terrain`:`over ground`}`,layout:c,vertex:f,fragment:p,primitive:u===`fill`?{topology:`triangle-list`,frontFace:`ccw`,cullMode:`back`}:{topology:`triangle-list`,cullMode:`none`},depthStencil:{format:n,depthWriteEnabled:!1,depthCompare:a?`less`:`always`,stencilFront:l,stencilBack:l,stencilReadMask:E.surfaceMaskBit,stencilWriteMask:0},multisample:{count:i}})},d=[];for(let e of[`flat`,`sphere`,`morph`])for(let t of[!1,!0])d.push(Promise.all([u(e,t,`fill`),u(e,t,`line`),u(e,t,`point`)]).then(([n,r,i])=>[`${e}/${t?`behind`:`over`}`,{fill:n,line:r,point:i}]));return new Map(await Promise.all(d))}};function J(e){return e[0].toUpperCase()+e.slice(1)}export{f as C,u as D,l as E,a as O,m as S,d as T,x as _,R as a,_ as b,N as c,T as d,E as f,v as g,S as h,z as i,i as k,M as l,C as m,H as n,L as o,D as p,q as r,P as s,V as t,w as u,y as v,p as w,o as x,b as y};