var e=`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// library
// The directional shadows' sampling, a port of the shadow half of the Swift
// engine's RenderUniforms.h: the two windows of the shadow map
// (ShadowCascadeAtlas), the tent filter, the self-shadow test of the
// receivers with normals and the shadow colour multiplier. Every receiver
// includes it (the buildings, the ground shadow mask, the trees' discs) and
// passes its own bindings in, so the file declares none.

// Grazing-wall cutoff of the geometric self-shadow test, in N·L, mirrored by
// ShadowFrameStateResolver.geometricCutoffStart and geometricCutoffEnd.
const kShadowGeometricCutoffStart: f32 = 0.18;
const kShadowGeometricCutoffEnd: f32 = 0.35;

// The slices of the shadow map, one per window (ShadowCascadeAtlas.slice).
const kShadowNearSlice: u32 = 0u;
const kShadowFarSlice: u32 = 1u;

// A self-shadowed wall is lit by the sky: it darkens by this share of the strength.
const kShadowSelfShadowStrengthFraction: f32 = 0.35;

// One shadow window, mirrored by ShadowUniformLayout (shadows/shadow-uniform.ts).
// worldToShadowTexture maps world space straight to the window's slice:
// xy the texture UV, z the comparison depth.
struct ShadowCascade {
    worldToShadowTexture: mat4x4f,
    // The factor the tent's taps are pushed out by, about the sample point.
    tentSpread: f32,
    // Where the window's shadows start to fade and where they are gone, as
    // radial distances from Shadow.fadeCenter.
    fadeStartDistance: f32,
    depthBias: f32,
    fadeEndDistance: f32,
    // The sampling rectangle, inset so the tent's taps never leave the window.
    // An empty one (minimum past maximum) is a window the frame has not got.
    uvMinimum: vec2f,
    uvMaximum: vec2f,
    // How far receivers with normals step off their surface, in world units.
    normalOffsetWorld: f32,
    padding: f32,
    texelSizeUV: vec2f,
}

// The frame's shadows, mirrored by ShadowUniformLayout.
struct Shadow {
    near: ShadowCascade,
    far: ShadowCascade,
    // xyz the camera's eye, w the strength (0 samples nothing).
    eyeAndStrength: vec4f,
    // xyz the unit direction towards the sun.
    lightDirection: vec4f,
    // xyz the cast of a fully shadowed surface.
    tint: vec4f,
    // The windows' centre in world xy, what every fade distance is measured from.
    fadeCenter: vec2f,
    padding: vec2f,
}

fn shadowCascadeIsEnabled(cascade: ShadowCascade) -> bool {
    return cascade.uvMaximum.x >= cascade.uvMinimum.x;
}

// Which window a point reads and how far its shadows have faded there:
// x the near window's share, y the fade (1 at full strength), z 1 with a far window.
fn shadowCascadeBlend(shadow: Shadow, worldXY: vec2f) -> vec3f {
    let distanceToCenter = length(worldXY - shadow.fadeCenter);
    let hasFar = shadowCascadeIsEnabled(shadow.far);
    let nearWeight = 1.0 - smoothstep(shadow.near.fadeStartDistance, shadow.near.fadeEndDistance, distanceToCenter);
    let farFade = 1.0 - smoothstep(shadow.far.fadeStartDistance, shadow.far.fadeEndDistance, distanceToCenter);
    return vec3f(nearWeight, select(nearWeight, farFade, hasFar), select(0.0, 1.0, hasFar));
}

fn shadowWindowContains(cascade: ShadowCascade, uvz: vec3f) -> bool {
    return uvz.x >= cascade.uvMinimum.x && uvz.x <= cascade.uvMaximum.x &&
           uvz.y >= cascade.uvMinimum.y && uvz.y <= cascade.uvMaximum.y &&
           uvz.z >= 0.0 && uvz.z <= 1.0;
}

// Castaño's 3x3 tent PCF: four bilinear compares with computed weights
// reconstruct a C1 tent, the same ramp in every orientation, so a shadow's
// edge stops carrying the grid's signature. \`tentSpread\` pushes the taps
// out about the sample point, which widens the ramp and cannot move the
// edge. Derivative-free, so callers may branch around it.
fn shadowWindowVisibility(cascade: ShadowCascade, shadowMap: texture_depth_2d_array, shadowSampler: sampler_comparison, slice: u32, uvz: vec3f) -> f32 {
    let reference = uvz.z - cascade.depthBias;
    let texelCoords = uvz.xy / cascade.texelSizeUV;
    let base = floor(texelCoords + 0.5);
    let s = texelCoords.x + 0.5 - base.x;
    let t = texelCoords.y + 0.5 - base.y;
    let baseUV = (base - 0.5) * cascade.texelSizeUV;

    let uw0 = 3.0 - 2.0 * s;
    let uw1 = 1.0 + 2.0 * s;
    let vw0 = 3.0 - 2.0 * t;
    let vw1 = 1.0 + 2.0 * t;
    let spread = cascade.tentSpread;
    let u0 = s + ((2.0 - s) / uw0 - 1.0 - s) * spread;
    let u1 = s + (s / uw1 + 1.0 - s) * spread;
    let v0 = t + ((2.0 - t) / vw0 - 1.0 - t) * spread;
    let v1 = t + (t / vw1 + 1.0 - t) * spread;

    var visibility = uw0 * vw0 * textureSampleCompareLevel(shadowMap, shadowSampler, baseUV + vec2f(u0, v0) * cascade.texelSizeUV, slice, reference);
    visibility += uw1 * vw0 * textureSampleCompareLevel(shadowMap, shadowSampler, baseUV + vec2f(u1, v0) * cascade.texelSizeUV, slice, reference);
    visibility += uw0 * vw1 * textureSampleCompareLevel(shadowMap, shadowSampler, baseUV + vec2f(u0, v1) * cascade.texelSizeUV, slice, reference);
    visibility += uw1 * vw1 * textureSampleCompareLevel(shadowMap, shadowSampler, baseUV + vec2f(u1, v1) * cascade.texelSizeUV, slice, reference);
    return visibility * (1.0 / 16.0);
}

// One window's visibility at a point: the receiver stepped off its surface
// by the window's normal offset (\`normal\` zero for the ground), lit outside
// its sampling rectangle. The light projection is orthographic: no divide.
fn shadowCascadeVisibility(cascade: ShadowCascade, shadowMap: texture_depth_2d_array, shadowSampler: sampler_comparison, slice: u32, worldPos: vec3f, normal: vec3f) -> f32 {
    let position = worldPos + normal * cascade.normalOffsetWorld;
    let uvz = (cascade.worldToShadowTexture * vec4f(position, 1.0)).xyz;
    if (!shadowWindowContains(cascade, uvz)) {
        return 1.0;
    }
    return shadowWindowVisibility(cascade, shadowMap, shadowSampler, slice, uvz);
}

// The map's visibility at a point, 1 fully lit: the near window where it
// reaches, the far one beyond it, the two blended over the near window's
// fade band.
fn shadowMapVisibility(shadow: Shadow, shadowMap: texture_depth_2d_array, shadowSampler: sampler_comparison, worldPos: vec3f, normal: vec3f, blend: vec3f) -> f32 {
    var nearVisibility = 1.0;
    if (blend.x > 0.0) {
        nearVisibility = shadowCascadeVisibility(shadow.near, shadowMap, shadowSampler, kShadowNearSlice, worldPos, normal);
    }
    if (blend.z == 0.0) {
        return nearVisibility;
    }
    var farVisibility = 1.0;
    if (blend.x < 1.0) {
        farVisibility = shadowCascadeVisibility(shadow.far, shadowMap, shadowSampler, kShadowFarSlice, worldPos, normal);
    }
    return mix(farVisibility, nearVisibility, blend.x);
}

// The shadow factor in [1 - strength, 1], 1 fully lit. \`surfaceNormal\` is
// the receiver's world normal, zero for the ground. A normal is flipped
// towards the camera first (two-sided), a face turned from the sun is
// self-shadowed by definition (with a smooth band at grazing angles), and
// the lookup steps off the surface along the normal against acne.
fn sampleShadowFactor(shadow: Shadow, shadowMap: texture_depth_2d_array, shadowSampler: sampler_comparison, worldPos: vec3f, surfaceNormal: vec3f) -> f32 {
    let strength = shadow.eyeAndStrength.w;
    if (strength <= 0.0) {
        return 1.0;
    }
    let blend = shadowCascadeBlend(shadow, worldPos.xy);
    let fade = blend.y;
    if (fade <= 0.0) {
        return 1.0;
    }
    let normalLength = length(surfaceNormal);
    let hasNormal = normalLength > 1e-5;
    var normal = surfaceNormal / max(normalLength, 1e-5);
    let towardsCamera = shadow.eyeAndStrength.xyz - worldPos;
    if (dot(normal, towardsCamera) < -0.05 * length(towardsCamera)) {
        normal = -normal;
    }
    normal *= select(0.0, 1.0, hasNormal);
    var geometricVisibility = 1.0;
    if (hasNormal) {
        geometricVisibility = smoothstep(kShadowGeometricCutoffStart, kShadowGeometricCutoffEnd, dot(normal, shadow.lightDirection.xyz));
    }
    if (geometricVisibility <= 0.0) {
        return 1.0 - kShadowSelfShadowStrengthFraction * strength * fade;
    }
    let mapVisibility = shadowMapVisibility(shadow, shadowMap, shadowSampler, worldPos, normal, blend);
    let selfShadowAmount = (1.0 - geometricVisibility) * kShadowSelfShadowStrengthFraction;
    let castShadowAmount = geometricVisibility * (1.0 - mapVisibility);
    let shadowAmount = min(1.0, selfShadowAmount + castShadowAmount);
    return 1.0 - shadowAmount * strength * fade;
}

// The colour a surface is multiplied by at a shadow factor: white lit, the
// strength's darkening times the tint fully shadowed.
fn shadowColorMultiplier(shadow: Shadow, factor: f32) -> vec3f {
    let strength = shadow.eyeAndStrength.w;
    if (strength <= 0.0) {
        return vec3f(1.0);
    }
    let amount = saturate((1.0 - factor) / strength);
    return mix(vec3f(1.0), (1.0 - strength) * shadow.tint.xyz, amount);
}
`;export{e as t};