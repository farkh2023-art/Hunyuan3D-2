import React, { useState } from 'react';
import { Sliders, Zap, Cpu, Settings2, RefreshCw } from 'lucide-react';

export type GenMode = 'Turbo' | 'Fast' | 'Standard';
export type DecodeMode = 'Low' | 'Standard' | 'High';

export interface GenerationSettings {
  genMode: GenMode;
  decodeMode: DecodeMode;
  numSteps: number;
  octreeResolution: number;
  cfgScale: number;
  numChunks: number;
  seed: number;
  randomizeSeed: boolean;
}

interface GenerationOptionsProps {
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
}

export const GenerationOptions: React.FC<GenerationOptionsProps> = ({ settings, onChange }) => {
  const [activeTab, setActiveTab] = useState<'preset' | 'advanced'>('preset');

  const handleGenModeChange = (mode: GenMode) => {
    let steps = 5;
    if (mode === 'Fast') steps = 10;
    if (mode === 'Standard') steps = 30;
    onChange({
      ...settings,
      genMode: mode,
      numSteps: steps,
    });
  };

  const handleDecodeModeChange = (mode: DecodeMode) => {
    let res = 256;
    if (mode === 'Low') res = 196;
    if (mode === 'High') res = 384;
    onChange({
      ...settings,
      decodeMode: mode,
      octreeResolution: res,
    });
  };

  const randomizeSeed = () => {
    onChange({
      ...settings,
      seed: Math.floor(Math.random() * 10000000),
    });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
      {/* Sub Tabs */}
      <div className="flex border-b border-slate-800 pb-2 mb-3.5 gap-2">
        <button
          onClick={() => setActiveTab('preset')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'preset'
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Pipeline Presets</span>
        </button>

        <button
          onClick={() => setActiveTab('advanced')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'advanced'
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Flow-Matching Parameters</span>
        </button>
      </div>

      {activeTab === 'preset' ? (
        <div className="space-y-4">
          {/* Generation Mode */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-300">Generation Mode</span>
              <span className="text-[10px] text-slate-500">Flow-matching speed</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['Turbo', 'Fast', 'Standard'] as GenMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleGenModeChange(mode)}
                  className={`py-2 px-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center transition-all ${
                    settings.genMode === mode
                      ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-300 shadow-sm shadow-cyan-900/40'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>{mode}</span>
                  <span className="text-[9px] font-normal text-slate-500 mt-0.5">
                    {mode === 'Turbo' ? '5 Steps' : mode === 'Fast' ? '10 Steps' : '30 Steps'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Decoding Resolution Mode */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-300">Decoding Octree Grid</span>
              <span className="text-[10px] text-slate-500">Voxel extraction detail</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['Low', 'Standard', 'High'] as DecodeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleDecodeModeChange(mode)}
                  className={`py-2 px-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center transition-all ${
                    settings.decodeMode === mode
                      ? 'border-indigo-500/50 bg-indigo-950/40 text-indigo-300 shadow-sm shadow-indigo-900/40'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>{mode}</span>
                  <span className="text-[9px] font-normal text-slate-500 mt-0.5">
                    {mode === 'Low' ? '196³' : mode === 'Standard' ? '256³' : '384³'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* Seed */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Seed</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.randomizeSeed}
                    onChange={(e) => onChange({ ...settings, randomizeSeed: e.target.checked })}
                    className="rounded accent-cyan-400"
                  />
                  <span>Randomize</span>
                </label>
                <button
                  onClick={randomizeSeed}
                  className="text-slate-400 hover:text-cyan-400 transition-colors"
                  title="Roll new seed"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <input
              type="number"
              value={settings.seed}
              onChange={(e) => onChange({ ...settings, seed: parseInt(e.target.value) || 0 })}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Inference Steps & CFG Guidance */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Steps</span>
                <span className="font-mono text-cyan-400">{settings.numSteps}</span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={settings.numSteps}
                onChange={(e) => onChange({ ...settings, numSteps: parseInt(e.target.value) })}
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Guidance CFG</span>
                <span className="font-mono text-cyan-400">{settings.cfgScale.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="15.0"
                step="0.5"
                value={settings.cfgScale}
                onChange={(e) => onChange({ ...settings, cfgScale: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Octree Resolution & Chunks */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Octree Res</span>
                <span className="font-mono text-cyan-400">{settings.octreeResolution}</span>
              </div>
              <input
                type="range"
                min="64"
                max="512"
                step="32"
                value={settings.octreeResolution}
                onChange={(e) => onChange({ ...settings, octreeResolution: parseInt(e.target.value) })}
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Vectset Chunks</span>
                <span className="font-mono text-cyan-400">{(settings.numChunks / 1000).toFixed(0)}k</span>
              </div>
              <input
                type="range"
                min="2000"
                max="16000"
                step="1000"
                value={settings.numChunks}
                onChange={(e) => onChange({ ...settings, numChunks: parseInt(e.target.value) })}
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
