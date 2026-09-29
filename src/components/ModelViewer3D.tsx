import React, { useRef, useState, useEffect } from 'react';
import { RotateCw, Sun, Maximize2, Camera, Download, Layers, ShieldCheck } from 'lucide-react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        'auto-rotate'?: boolean | string;
        'camera-controls'?: boolean | string;
        'shadow-intensity'?: string;
        'environment-image'?: string;
        exposure?: string;
        'camera-orbit'?: string;
        'camera-target'?: string;
        'field-of-view'?: string;
        loading?: string;
        ar?: boolean | string;
        style?: React.CSSProperties;
      };
    }
  }
}

interface ModelViewer3DProps {
  modelUrl: string;
  isTextured: boolean;
  modelTitle?: string;
}

export const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
  modelUrl,
  isTextured,
  modelTitle = 'Hunyuan3D Generated Asset',
}) => {
  const viewerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [exposure, setExposure] = useState<number>(1.0);
  const [environment, setEnvironment] = useState<'neutral' | 'gradient' | 'white'>('neutral');
  const [wireframeMode, setWireframeMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const onLoad = () => {
      setHasLoaded(true);
      if (wireframeMode && el.model && el.model.materials) {
        // Toggle wireframe if supported
      }
    };

    el.addEventListener('load', onLoad);
    return () => {
      el.removeEventListener('load', onLoad);
    };
  }, [modelUrl, wireframeMode]);

  const handleCaptureSnapshot = () => {
    const el = viewerRef.current;
    if (!el) return;
    try {
      const dataUrl = el.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `hunyuan3d_snapshot_${Date.now()}.png`;
      a.click();
    } catch (e) {
      console.error('Failed to take snapshot:', e);
    }
  };

  const handleResetCamera = () => {
    const el = viewerRef.current;
    if (el) {
      el.cameraOrbit = '0deg 75deg 105%';
      el.cameraTarget = 'auto auto auto';
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[460px] bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 rounded-xl overflow-hidden border border-slate-800 flex flex-col shadow-2xl"
    >
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 pointer-events-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-slate-200 truncate max-w-[200px]">{modelTitle}</span>
          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
            {isTextured ? 'Textured' : 'Clay / Shape'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md p-1 rounded-lg border border-slate-700/60 pointer-events-auto">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle Auto Rotate"
            className={`p-1.5 rounded-md transition-colors ${
              autoRotate ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            onClick={handleResetCamera}
            title="Reset Camera"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-xs font-mono px-2"
          >
            Recenter
          </button>

          <button
            onClick={handleCaptureSnapshot}
            title="Capture Screenshot"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <Camera className="w-4 h-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3D Model Viewer Canvas */}
      <div className="flex-1 w-full h-full relative flex items-center justify-center">
        <model-viewer
          ref={viewerRef}
          src={modelUrl}
          alt={modelTitle}
          auto-rotate={autoRotate ? 'true' : undefined}
          camera-controls="true"
          shadow-intensity="1.2"
          environment-image={
            environment === 'gradient'
              ? '/assets/env_maps/gradient.jpg'
              : environment === 'white'
              ? '/assets/env_maps/white.jpg'
              : 'neutral'
          }
          exposure={exposure.toString()}
          camera-orbit="0deg 75deg 105%"
          loading="eager"
          ar="true"
          style={{ width: '100%', height: '100%', outline: 'none' }}
        />

        {/* Ambient Grid overlay in background */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/10 via-transparent to-transparent -z-10" />
      </div>

      {/* Bottom Floating Environment & Lighting Bar */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 pointer-events-auto">
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] text-slate-300">Light:</span>
          <input
            type="range"
            min="0.3"
            max="2.0"
            step="0.1"
            value={exposure}
            onChange={(e) => setExposure(parseFloat(e.target.value))}
            className="w-16 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="w-[1px] h-3 bg-slate-700 mx-1" />
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as any)}
            className="text-[11px] bg-slate-800 text-slate-300 border border-slate-700 rounded px-1.5 py-0.5 outline-none cursor-pointer"
          >
            <option value="neutral">Neutral HDR</option>
            <option value="gradient">Gradient Studio</option>
            <option value="white">High Key White</option>
          </select>
        </div>

        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 pointer-events-auto">
          <a
            href={modelUrl}
            download={`hunyuan3d_model_${Date.now()}.glb`}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .GLB</span>
          </a>
        </div>
      </div>
    </div>
  );
};
