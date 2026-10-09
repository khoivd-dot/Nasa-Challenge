// Minimal WebGL2 helpers.

export function createProgram(gl, vsSource, fsSource, attribs = []) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  attribs.forEach((name, i) => gl.bindAttribLocation(prog, i, name));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  // Cache uniform locations.
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u: uniforms };
}

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = source
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(3)} ${l}`)
      .join('\n');
    throw new Error(`Shader compile failed: ${log}\n${numbered}`);
  }
  return sh;
}

/**
 * Set uniforms from a plain object. Numbers -> 1f, arrays by length
 * (2/3/4 -> vecN, 9 -> mat3, 12 -> vec3[4]), {i: n} -> 1i.
 */
export function setUniforms(gl, p, values) {
  for (const k in values) {
    const loc = p.u[k];
    if (loc === undefined || loc === null) continue;
    const v = values[k];
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v && v.i !== undefined) gl.uniform1i(loc, v.i);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
    else if (v.length === 12) gl.uniform3fv(loc, v);
  }
}

export function createBuffer(gl, data, usage = gl.STATIC_DRAW) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (typeof data === 'number') gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  else gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return buf;
}

/**
 * Bind float attributes of an interleaved buffer.
 * layout: [{loc, size, offset}], stride in bytes, divisor (0 or 1),
 * base: byte offset added to every attribute (used to draw instance ranges).
 */
export function bindAttribs(gl, buf, layout, stride, divisor = 0, base = 0) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const a of layout) {
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, a.type ?? gl.FLOAT, a.normalized ?? false, stride, base + a.offset);
    gl.vertexAttribDivisor(a.loc, divisor);
  }
}
