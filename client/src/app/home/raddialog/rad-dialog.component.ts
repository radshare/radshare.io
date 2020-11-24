import {AfterViewInit, Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {FormControl} from '@angular/forms';
import Items from 'warframe-items';
import {ReplaySubject, Subject} from 'rxjs';
import {MatSelect} from '@angular/material/select';
import {take, takeUntil} from 'rxjs/operators';

const wfItems = require('warframe-items');

export interface RelicName {
  name: string;
}

@Component({
  selector: 'app-raddialog',
  templateUrl: './rad-dialog.component.html',
  styleUrls: ['./rad-dialog.component.css']
})

export class RadDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  relicsList: Items = new wfItems({category : ['Relics']});

  relicsNames: RelicName[];
  relicCtrl: FormControl = new FormControl();
  relicFilterCtrl: FormControl = new FormControl();
  filteredRelics: ReplaySubject<RelicName[]> = new ReplaySubject<RelicName[]>(1);
  _onDestroy = new Subject<void>();

  @ViewChild('singleSelect', {static: true}) singleSelect: MatSelect;

  constructor() {
    this.relicsNames = this.toRelicName(this.relicsList);
  }

  ngOnInit(): void {
    console.log(this.relicsNames);
    this.filteredRelics.next(this.relicsNames.slice());
    this.relicFilterCtrl.valueChanges.pipe(takeUntil(this._onDestroy))
      .subscribe(() => {
        this.filterRelics();
      });
  }

  ngAfterViewInit(): void {
  }

  ngOnDestroy(): void {
    this._onDestroy.next();
    this._onDestroy.complete();
  }

  toRelicName(relicsArray: Items): RelicName[]{
    let returnArray: RelicName[] = [];
    let nameArray: string[] = [];
    let regexp: RegExp = new RegExp('( Intact| Flawless| Exceptional| Radiant)');
    relicsArray.forEach(relic => {
      nameArray.push(relic.name.replace(regexp, ''));
    });

    const uniqueSet = new Set(nameArray);
    [...uniqueSet].forEach(relicName => {
      returnArray.push({name : relicName});
    });
    return returnArray;
  }

  newRadRoom() {

  }

  private filterRelics() {
    if (!this.relicsNames) {
      return;
    }
    let search = this.relicFilterCtrl.value;
    if (!search){
      this.filteredRelics.next(this.relicsNames.slice());
      return;
    }
    else {
      search = search.toLowerCase();
    }
    this.filteredRelics.next(
      this.relicsNames
        .filter(relic => relic.name.toLowerCase().indexOf(search) > -1)
    );
  }
}
