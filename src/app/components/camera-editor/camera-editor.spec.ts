import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CameraEditorComponent } from './camera-editor';
import { CameraService } from '../../services/camera.service';

import type { Camera } from '../../models/camera.model';

function inputs(fixture: ComponentFixture<CameraEditorComponent>): HTMLInputElement[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('input'));
}

function inputAt(
  fixture: ComponentFixture<CameraEditorComponent>,
  index: number,
): HTMLInputElement {
  const input = inputs(fixture)[index];
  if (!input) {
    throw new Error(`No input at index ${index}`);
  }
  return input;
}

function setValue(input: HTMLInputElement, value: string, eventType: 'change' | 'input'): void {
  input.value = value;
  input.dispatchEvent(new Event(eventType));
}

describe('CameraEditorComponent', () => {
  let fixture: ComponentFixture<CameraEditorComponent>;
  let service: CameraService;
  let camera: Camera;

  /** Re-binds the input to the latest camera state from the service, as the sidebar does. */
  async function syncInput(): Promise<void> {
    const latest = service.cameras().find((c) => c.id === camera.id);
    if (latest) {
      fixture.componentRef.setInput('camera', latest);
    }
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [CameraEditorComponent] }).compileComponents();
    service = TestBed.inject(CameraService);
    camera = service.addCamera(40, -74.5);
    fixture = TestBed.createComponent(CameraEditorComponent);
    fixture.componentRef.setInput('camera', camera);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders the camera values into the form', () => {
    const [name, headingNumber, headingRange, fovNumber, fovRange, rangeNumber, rangeRange] =
      inputs(fixture);

    expect(name?.value).toBe('Camera 1');
    expect(headingNumber?.value).toBe('0');
    expect(headingRange?.value).toBe('0');
    expect(fovNumber?.value).toBe('60');
    expect(fovRange?.value).toBe('60');
    expect(rangeNumber?.value).toBe('50');
    expect(rangeRange?.value).toBe('50');
  });

  it('updates the name on change', async () => {
    setValue(inputAt(fixture, 0), 'Front door', 'change');
    await syncInput();

    expect(service.selectedCamera()?.name).toBe('Front door');
    expect(inputAt(fixture, 0).value).toBe('Front door');
  });

  it('updates the heading from the number input and the slider', async () => {
    setValue(inputAt(fixture, 1), '90', 'change');
    expect(service.selectedCamera()?.heading).toBe(90);

    setValue(inputAt(fixture, 2), '270', 'input');
    await syncInput();

    expect(service.selectedCamera()?.heading).toBe(270);
    expect(inputAt(fixture, 1).value).toBe('270');
  });

  it('updates the FOV from the number input and the slider', () => {
    setValue(inputAt(fixture, 3), '120', 'change');
    expect(service.selectedCamera()?.fov).toBe(120);

    setValue(inputAt(fixture, 4), '30', 'input');
    expect(service.selectedCamera()?.fov).toBe(30);
  });

  it('updates the range from the number input and the slider', () => {
    setValue(inputAt(fixture, 5), '200', 'change');
    expect(service.selectedCamera()?.range).toBe(200);

    setValue(inputAt(fixture, 6), '15', 'input');
    expect(service.selectedCamera()?.range).toBe(15);
  });

  it('only updates the bound camera', () => {
    const other = service.addCamera(0, 0);

    setValue(inputAt(fixture, 1), '45', 'change');

    expect(service.cameras().find((c) => c.id === camera.id)?.heading).toBe(45);
    expect(service.cameras().find((c) => c.id === other.id)?.heading).toBe(0);
  });

  it('clones the camera when Clone is clicked', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();

    expect(service.cameras()).toHaveLength(2);
    expect(service.selectedCamera()?.name).toBe('Camera 1 (copy)');
  });
});
