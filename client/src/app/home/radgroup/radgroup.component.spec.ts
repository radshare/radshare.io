import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RadgroupComponent } from './radgroup.component';

describe('RadgroupComponent', () => {
  let component: RadgroupComponent;
  let fixture: ComponentFixture<RadgroupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ RadgroupComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(RadgroupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
