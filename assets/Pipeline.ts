import { _decorator, rendering, renderer, game, Game, gfx, Material, resources, Camera } from 'cc';
import { JSB } from 'cc/env';
import { AntiAliasing,
    buildForwardPass, buildBloomPasses, buildFxaaPass, buildPostprocessPass, buildUIPass,
    buildNativeForwardPass,
    isUICamera, decideProfilerCamera, getRenderArea, getLoadOpOfClearFlag, getClearFlags } from './PassUtils';
const { ccclass, property } = _decorator;

let sub0Mat: Material = null;
let sub1Mat: Material = null;
let sub2Mat: Material = null;
let blitMat: Material = null;
let rtMat: Material = null;

resources.load('custom-sub0', Material, (error, material) => {
    sub0Mat = material;
});

resources.load('custom-sub1', Material, (error, material) => {
    sub1Mat = material;
});

resources.load('custom-sub2', Material, (error, material) => {
    sub2Mat = material;
});

resources.load('blitMat', Material, (error, material) => {
    blitMat = material;
});

resources.load('RayTracing', Material, (error, material) => {
    rtMat = material;
});

function addOrUpdateRenderTarget(name: string, format: gfx.Format, width: number, height: number, residency: rendering.ResourceResidency, pipeline: rendering.Pipeline) {

    if (!pipeline.containsResource(name)) {
        pipeline.addRenderTarget(name, format, width, height, residency);
    } else {
        pipeline.updateRenderTarget(name, width, height);
    }
}

export function getMaterial(path: string) {
    let mat = new Material();
    mat.initialize({
        effectName: path,
    });
    for (let i = 0; i < mat.passes.length; ++i) {
        mat.passes[i].tryCompile();
    }
    return mat;
}

export function buildProgrammableBlendPass(camera: renderer.scene.Camera, pipeline: rendering.Pipeline) {
    const area = getRenderArea(camera, camera.window.width, camera.window.height);
    const width = area.width;
    const height = area.height;

    addOrUpdateRenderTarget("color0", gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MEMORYLESS, pipeline);
    addOrUpdateRenderTarget("color1", gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MEMORYLESS, pipeline);
    addOrUpdateRenderTarget("color2", gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MEMORYLESS, pipeline);
    addOrUpdateRenderTarget("color3", gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MEMORYLESS, pipeline);
    addOrUpdateRenderTarget("finalColor", gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MANAGED, pipeline);

    const clearColor = new gfx.Color(0, 0, 0, 0);
    const builder = pipeline.addRenderPass(width, height, 'default');
    const subpass0 = builder.addRenderSubpass('custom-sub0');
    subpass0.addRenderTarget("color0", rendering.AccessType.WRITE, "_", gfx.LoadOp.CLEAR, gfx.StoreOp.DISCARD, clearColor);
    subpass0.addRenderTarget("color1", rendering.AccessType.WRITE, "_", gfx.LoadOp.CLEAR, gfx.StoreOp.DISCARD, clearColor);
    subpass0.addRenderTarget("color2", rendering.AccessType.WRITE, "_", gfx.LoadOp.CLEAR, gfx.StoreOp.DISCARD, clearColor);
    subpass0.addRenderTarget("color3", rendering.AccessType.WRITE, "_", gfx.LoadOp.CLEAR, gfx.StoreOp.DISCARD, clearColor);

    subpass0
        .addQueue(rendering.QueueHint.RENDER_OPAQUE)
        .addFullscreenQuad(sub0Mat, 0);

    const subpass1 = builder.addRenderSubpass('custom-sub1');
    subpass1.addRenderTarget("color0", rendering.AccessType.READ, "c0", gfx.LoadOp.DISCARD, gfx.StoreOp.DISCARD, clearColor);
    subpass1.addRenderTarget("color1", rendering.AccessType.READ, "c1", gfx.LoadOp.DISCARD, gfx.StoreOp.DISCARD, clearColor);
    subpass1.addRenderTarget("finalColor", rendering.AccessType.WRITE, "outColor", gfx.LoadOp.CLEAR, gfx.StoreOp.STORE, clearColor);

    subpass1
        .addQueue(rendering.QueueHint.RENDER_OPAQUE)
        .addFullscreenQuad(sub1Mat, 0);

    const subpass2 = builder.addRenderSubpass('custom-sub2');
    subpass2.addRenderTarget("color2", rendering.AccessType.READ, "c0", gfx.LoadOp.DISCARD, gfx.StoreOp.DISCARD, clearColor);
    subpass2.addRenderTarget("color3", rendering.AccessType.READ, "c1", gfx.LoadOp.DISCARD, gfx.StoreOp.DISCARD, clearColor);
    subpass2.addRenderTarget("finalColor", rendering.AccessType.READ_WRITE, "outColor", gfx.LoadOp.DISCARD, gfx.StoreOp.STORE, clearColor);

    subpass2
        .addQueue(rendering.QueueHint.RENDER_OPAQUE)
        .addFullscreenQuad(sub2Mat, 0);

    // const layout = pipeline.device.createDescriptorSetLayout(new gfx.DescriptorSetLayoutInfo());

    // let setInfo = new gfx.DescriptorSetInfo();
    // setInfo.layout = layout;
    // const set = pipeline.device.createDescriptorSet(setInfo);
    // set.bindTexture(0, null, 0);
}

export function buildRayTracingComputePass(camera: renderer.scene.Camera, pipeline: rendering.Pipeline) {
    const cs = pipeline.addComputePass('user-ray-tracing');
    const area = getRenderArea(camera, camera.window.width, camera.window.height);
    const width = area.width;
    const height = area.height;

    const csOutput = 'cs_output';
    if (!pipeline.containsResource(csOutput)) {
        pipeline.addStorageTexture(csOutput, gfx.Format.RGBA8, width, height, rendering.ResourceResidency.MANAGED);
    } else {
        pipeline.updateStorageTexture(csOutput, width, height, gfx.Format.RGBA8);
    }
    
    cs.addStorageImage(csOutput, rendering.AccessType.WRITE, 'outputImage');
    cs.addQueue().addDispatch(width / 8, height / 4, 1, rtMat);

    return csOutput;
}

export function buildNativePipeline(cameras: renderer.scene.Camera[], pipeline: rendering.Pipeline) {
    // buildProgrammableBlendPass(cameras[0], pipeline);
    const rtName = buildRayTracingComputePass(cameras[0], pipeline);
    // buildNativeForwardPass(cameras[0], pipeline);
    buildPostprocessPass(cameras[0], pipeline, rtName, AntiAliasing.NONE);
}

export function buildWebPipeline (cameras: renderer.scene.Camera[], pipeline: rendering.Pipeline) {
    decideProfilerCamera(cameras);
    const camera = cameras[0];
    const isGameView = camera.cameraUsage === renderer.scene.CameraUsage.GAME
        || camera.cameraUsage === renderer.scene.CameraUsage.GAME_VIEW;
    if (!isGameView) {
        // forward pass
        buildForwardPass(camera, pipeline, isGameView);
        return;
    }
    // TODO: The actual project is not so simple to determine whether the ui camera, here is just as a demo demonstration.
    if (!isUICamera(camera)) {
        // forward pass
        const forwardInfo = buildForwardPass(camera, pipeline, isGameView);
        // fxaa pass
        const fxaaInfo = buildFxaaPass(camera, pipeline, forwardInfo.rtName);
        // bloom passes
        const bloomInfo = buildBloomPasses(camera, pipeline, fxaaInfo.rtName);
        // Present Pass
        buildPostprocessPass(camera, pipeline, bloomInfo.rtName, AntiAliasing.NONE);
        return;
    }
    // render ui
    buildUIPass(camera, pipeline);
}

@ccclass('Pipeline')
export class TestCustomPipeline  implements rendering.PipelineBuilder {
    setup(cameras: renderer.scene.Camera[], pipeline: rendering.Pipeline): void {
        if (!JSB) {
            buildWebPipeline(cameras, pipeline);
        } else {
            buildNativePipeline(cameras, pipeline);
        }
    }
}

export function builtBlitPass(camera: renderer.scene.Camera, pipeline: rendering.Pipeline) {
    const area = getRenderArea(camera, camera.window.width, camera.window.height);
    const width = area.width;
    const height = area.height;

    if (!pipeline.containsResource("output")) {
        pipeline.addRenderWindow("output", gfx.Format.RGBA8, width, height, camera.window);
    } else {
        pipeline.updateRenderWindow("output", camera.window);
    }
    
    const clearColor = new gfx.Color(0, 0, 0, 0);
    const builder = pipeline.addRenderPass(width, height, 'blit-custom');
    builder.addRenderTarget("output", gfx.LoadOp.CLEAR, gfx.StoreOp.STORE, clearColor);
    builder.addQueue(rendering.QueueHint.NONE).addFullscreenQuad(blitMat, 0, rendering.SceneFlags.NONE);
}

@ccclass('Pipeline2')
export class TestBlitPipeline  implements rendering.PipelineBuilder {
    setup(cameras: renderer.scene.Camera[], pipeline: rendering.Pipeline): void {
        decideProfilerCamera(cameras);
        const camera = cameras[0];
        const isGameView = camera.cameraUsage === renderer.scene.CameraUsage.GAME
            || camera.cameraUsage === renderer.scene.CameraUsage.GAME_VIEW;
        if (!isGameView) {
            // forward pass
            buildForwardPass(camera, pipeline, isGameView);
            return;
        }


        let blitCamera = null;
        let onScreenCamera = null;
        for (let i = 0; i < cameras.length; ++i) {
            const camera = cameras[i];
            if (camera.name === 'Main Camera-001') {
                blitCamera = camera;
            }
            if (camera.name === 'Main Camera-002') {
                onScreenCamera = camera;
            }
        }


        builtBlitPass(blitCamera, pipeline);

        const onScreen = true;
        let screenBuffer = null;

        if (onScreen) {
            buildPostprocessPass(onScreenCamera, pipeline, "output", AntiAliasing.NONE);
        } else {
            const regions: gfx.BufferTextureCopy[] = [];
            const region0 = new gfx.BufferTextureCopy();
            region0.texOffset.x = 0;
            region0.texOffset.y = 0;
            region0.texExtent.width = blitCamera.window.width;
            region0.texExtent.height = blitCamera.window.height;
            regions.push(region0);
        
            const needSize = 4 * region0.texExtent.width * region0.texExtent.height;
            screenBuffer = new Uint8Array(needSize);
        
            const bufferViews: ArrayBufferView[] = [];
            bufferViews.push(screenBuffer);
        
            pipeline.device.copyTextureToBuffers(blitCamera.window.framebuffer.colorTextures[0], bufferViews, regions);
        }
    }
}

game.on(Game.EVENT_RENDERER_INITED, () => {
    rendering.setCustomPipeline('CustomPipeline', new TestCustomPipeline);
    rendering.setCustomPipeline('CustomPipeline2', new TestBlitPipeline);
});