import {Component, OnInit, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {Router} from '@angular/router';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {

  constructor(private relics: RelicService, private router: Router) { }

  @ViewChild('radshareTable') Table;
  //@ViewChild(MatPaginator) paginator: MatPaginator;

  ngOnInit(): void {
    this.loadRadshares();
  }

  loadRadshares(){
    this.relics.getRadshares().subscribe(

    );
  }

}
