var e=`// Copyright (c) 2025-2026 Artem Bobkin.
// SPDX-License-Identifier: MIT

// library
// The fog on the ground of the flat map (GroundFogSettings), a port of the
// Swift engine's GroundFog.h: thickest at the ground, its density falling
// by a factor of e every \`height\` upward, gathered along the view ray past
// \`startDistance\` from the camera and coming in smoothly over
// \`startSoftness\` past it. Every shader of what stands on the map mixes its
// colour toward the fog's by groundFogAmount. The fog's colour is the sky's
// in the direction of the view (groundFogColor), so a far building veiled
// in full is the sky behind it. Every length is in meters on the ground:
// the render world's units are turned into meters by the uniform's factor.
//
// A library: a shader prepends it and declares its own binding of the
// uniform, \`var<uniform> groundFog: GroundFog\`, then calls applyGroundFog.

/// Mirror of GroundFogUniform (ground-fog-uniform.ts).
struct GroundFog {
    /// The fog's colour at the horizon line and its density at the ground, per meter.
    colorAndDensity: vec4f,
    /// The eye in render world units and the meters one unit spans.
    eyeAndMetersPerUnit: vec4f,
    /// The height its density falls by e over and the distance it begins at,
    /// both in meters, the most it veils, and its strength (0 with the fog
    /// off and on the globe).
    parameters: vec4f,
    /// The sky's colour away from the line and the e-fold, in radians above
    /// the line, of the horizon's glow (0 with no sky painted).
    skyColorAndGradient: vec4f,
    /// The softness of the start in meters, the altitude of the plane the
    /// ground is drawn from, the altitude the density is stated at, padding.
    startSoftness: vec4f,
}

/// How much of the fog lies between the eye and a point, 0 to 1: one minus
/// the light that crosses it, the density's integral along the ray from the
/// start distance to the point. Along the ray the height is linear, so the
/// integral of e^(-z/H) is exact. Past the start the density comes in on a
/// smoothstep over the softness, whose integral is exact too, so the veil
/// starts with no edge.
fn groundFogAmount(worldPosition: vec3f, fog: GroundFog) -> f32 {
    let strength = fog.parameters.w;
    if (strength <= 0.0) {
        return 0.0;
    }
    let metersPerUnit = fog.eyeAndMetersPerUnit.w;
    let eye = fog.eyeAndMetersPerUnit.xyz * metersPerUnit;
    let ray = worldPosition * metersPerUnit - eye;
    let rayLength = length(ray);
    let start = fog.parameters.y;
    if (rayLength <= start) {
        return 0.0;
    }
    let height = max(fog.parameters.x, 1e-3);
    // Heights over the altitude the density is stated at: at and below the
    // base altitude the fog is at its full density.
    let base = fog.startSoftness.y - fog.startSoftness.z;
    let z0 = max(eye.z + ray.z * (start / rayLength) + base, 0.0);
    let z1 = max(eye.z + ray.z + base, 0.0);
    let rise = (z1 - z0) / height;
    let e0 = exp(-z0 / height);
    let meanDensity = select(e0, (e0 - exp(-z1 / height)) / rise, abs(rise) > 1e-4);
    let span = rayLength - start;
    let softness = fog.startSoftness.x;
    var weightedSpan = span;
    if (softness > 0.0) {
        let t = span / softness;
        weightedSpan = select(span - 0.5 * softness, softness * (t * t * t - 0.5 * t * t * t * t), t < 1.0);
    }
    let opticalDepth = fog.colorAndDensity.w * weightedSpan * meanDensity;
    return min(1.0 - exp(-opticalDepth), fog.parameters.z) * strength;
}

/// The fog's colour in the direction of a point: the fog's own colour at and
/// under the line decaying into the sky colour above it. Mirrored by
/// GroundFogUniform.color.
fn groundFogColor(worldPosition: vec3f, fog: GroundFog) -> vec3f {
    let base = fog.colorAndDensity.rgb;
    let gradient = fog.skyColorAndGradient.w;
    if (gradient <= 0.0) {
        return base;
    }
    let ray = worldPosition - fog.eyeAndMetersPerUnit.xyz;
    let rayLength = length(ray);
    if (rayLength <= 0.0) {
        return base;
    }
    // On the plane the line is the eye's horizontal, so the angle above it
    // is the ray's elevation.
    let elevation = asin(clamp(ray.z / rayLength, -1.0, 1.0));
    if (elevation <= 0.0) {
        return base;
    }
    return mix(base, fog.skyColorAndGradient.rgb, 1.0 - exp(-elevation / gradient));
}

fn applyGroundFog(color: vec3f, worldPosition: vec3f, fog: GroundFog) -> vec3f {
    let amount = groundFogAmount(worldPosition, fog);
    if (amount <= 0.0) {
        return color;
    }
    return mix(color, groundFogColor(worldPosition, fog), amount);
}
`;export{e as t};