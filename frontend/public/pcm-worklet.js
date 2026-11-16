const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
const METER_EVERY_FRAMES = 16;

function makeLowpass(sampleRate, cutoff, q) {
    const omega = 2 * Math.PI * cutoff / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const alpha = sine / (2 * q);
    const a0 = 1 + alpha;

    return {
        b0: ((1 - cosine) / 2) / a0,
        b1: (1 - cosine) / a0,
        b2: ((1 - cosine) / 2) / a0,
        a1: (-2 * cosine) / a0,
        a2: (1 - alpha) / a0,
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 0,
    };
}

function runLowpass(filter, input) {
    const output =
        filter.b0 * input +
        filter.b1 * filter.x1 +
        filter.b2 * filter.x2 -
        filter.a1 * filter.y1 -
        filter.a2 * filter.y2;

    filter.x2 = filter.x1;
    filter.x1 = input;
    filter.y2 = filter.y1;
    filter.y1 = output;

    return output;
}

class Pcm16Processor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.sourceRate = sampleRate;
        this.resampleStep = this.sourceRate / TARGET_SAMPLE_RATE;
        this.sourcePosition = 0;
        this.nextOutputPosition = 0;
        this.previousSample = 0;
        this.hasPreviousSample = false;

        // Two cascaded biquads form a 4th-order Butterworth low-pass.
        const cutoff = Math.min(7000, this.sourceRate * 0.4);
        this.filters = [
            makeLowpass(this.sourceRate, cutoff, 0.5411961),
            makeLowpass(this.sourceRate, cutoff, 1.306563),
        ];

        this.frame = new Int16Array(FRAME_SIZE);
        this.offset = 0;
        this.inputChannels = 0;
        this.framesSinceMeter = 0;
        this.meterSamples = 0;
        this.meterEnergy = 0;
        this.meterPeak = 0;
    }

    writeOutputSample(value) {
        const sample = Math.max(-1, Math.min(1, value));

        this.frame[this.offset++] =
            sample < 0 ? sample * 32768 : sample * 32767;

        if (this.offset === FRAME_SIZE) {
            const packet = this.frame;
            this.frame = new Int16Array(FRAME_SIZE);
            this.offset = 0;

            this.port.postMessage(packet.buffer, [packet.buffer]);

            this.framesSinceMeter++;
            if (this.framesSinceMeter >= METER_EVERY_FRAMES) {
                const rms = this.meterSamples > 0
                    ? Math.sqrt(this.meterEnergy / this.meterSamples)
                    : 0;

                this.port.postMessage({
                    type: "mic_metrics",
                    inputChannels: this.inputChannels,
                    sourceSampleRate: this.sourceRate,
                    rms,
                    peak: this.meterPeak,
                });

                this.framesSinceMeter = 0;
                this.meterSamples = 0;
                this.meterEnergy = 0;
                this.meterPeak = 0;
            }
        }
    }

    process(inputs, outputs) {
        const channels = inputs[0] ?? [];

        for (const channel of outputs[0] ?? []) {
            channel.fill(0);
        }

        if (!channels.length || !channels[0]?.length) {
            return true;
        }

        const frameLength = channels[0].length;
        this.inputChannels = channels.length;

        // Downmix all channels. If opposing channels nearly cancel, use the
        // strongest channel to avoid sending silence for unusual device wiring.
        let maxChannel = channels[0];
        let maxChannelEnergy = -1;
        let averageEnergy = 0;

        for (const channel of channels) {
            let energy = 0;
            for (let i = 0; i < frameLength; i++) {
                energy += channel[i] * channel[i];
            }
            energy /= frameLength;
            averageEnergy += energy;

            if (energy > maxChannelEnergy) {
                maxChannelEnergy = energy;
                maxChannel = channel;
            }
        }

        averageEnergy /= channels.length;

        let downmixEnergy = 0;
        for (let i = 0; i < frameLength; i++) {
            let value = 0;
            for (const channel of channels) {
                value += channel[i];
            }
            value /= channels.length;
            downmixEnergy += value * value;
        }
        downmixEnergy /= frameLength;

        const useStrongestChannel =
            channels.length > 1 &&
            downmixEnergy < averageEnergy * 0.0625;

        for (let i = 0; i < frameLength; i++) {
            let inputSample;

            if (channels.length === 1) {
                inputSample = channels[0][i];
            } else if (useStrongestChannel) {
                inputSample = maxChannel[i];
            } else {
                inputSample = 0;
                for (const channel of channels) {
                    inputSample += channel[i];
                }
                inputSample /= channels.length;
            }

            this.meterSamples++;
            this.meterEnergy += inputSample * inputSample;
            this.meterPeak = Math.max(this.meterPeak, Math.abs(inputSample));

            let filteredSample = inputSample;
            for (const filter of this.filters) {
                filteredSample = runLowpass(filter, filteredSample);
            }

            if (!this.hasPreviousSample) {
                this.previousSample = filteredSample;
                this.hasPreviousSample = true;
                this.writeOutputSample(filteredSample);
                this.nextOutputPosition = this.resampleStep;
                this.sourcePosition = 1;
                continue;
            }

            const currentPosition = this.sourcePosition;

            while (this.nextOutputPosition <= currentPosition) {
                const fraction = Math.max(
                    0,
                    Math.min(
                        1,
                        this.nextOutputPosition - (currentPosition - 1)
                    )
                );

                const outputSample =
                    this.previousSample +
                    (filteredSample - this.previousSample) * fraction;

                this.writeOutputSample(outputSample);
                this.nextOutputPosition += this.resampleStep;
            }

            this.previousSample = filteredSample;
            this.sourcePosition += 1;
        }

        return true;
    }
}

registerProcessor("pcm16-processor", Pcm16Processor);
